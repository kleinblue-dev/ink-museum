// journey.js — 七步动线（enter → pre → scene → line → ink → post → reveal）的 DOM 渲染与交互。
// 全部文案来自 content/content.js；本模块不写死任何可见中文。
//
// 落墨引擎按 SPEC §4 的契约从 js/ink/engine.js 静态引入（build-standalone 禁止动态 import）；
// 引擎未就绪或调用失败时退到本文件的 createFallbackInk 占位笔迹，保证流程可走通。

import { CONTENT } from '../content/content.js';
import { createInkEngine } from './ink/engine.js';
import { SCALE_KEYS, backStep, canGoBack, computeDelta, createSession, dotPlan, guardStep, isPostComplete, isPreComplete, isValidTransition, nextStepOf, normalizeScale, nowIso, pickFeedback, resetForReplay, stepIndex } from './state.js';
import { buildPayload, currentApiMode, ensureApiMode, makeIdempotencyKey, makeLocalId, saveLocalScroll, saveScroll } from './api.js';
import { compactScrollDataUrl, composeScroll, downloadDataUrl, formatDate } from './export.js';
import { preloadBackground } from './scenes.js';
import { announce, blurActive, button, el, focusNode, closeTopOverlay, hasOverlay, motionMs, qs, reducedMotion, setBodyStep, toast, wait } from './ui.js';

const LINE_TONES = ['light', 'medium', 'dark'];
const TONE_ALPHA = { light: 0.16, medium: 0.36, dark: 0.62 };
const FALLBACK_MAX_STROKES = 60;

function findScene(sceneId) {
  const scenes = CONTENT.scenes || [];
  for (let i = 0; i < scenes.length; i += 1) {
    if (scenes[i].id === sceneId) return scenes[i];
  }
  return null;
}

function preloadThumb(src) {
  if (!src || typeof Image !== 'function') return;
  const probe = new Image();
  probe.decoding = 'async';
  probe.src = src;
}

function scaleValueText(item, value) {
  const ends = (CONTENT.pre && CONTENT.pre.ends) || ['不', '很'];
  const label = (item && item.label) || '';
  const n = Math.round(Number(value));
  if (n <= 1) return ends[0] + label;
  if (n >= 7) return ends[1] + label;
  return label + ' ' + n;
}

function fallbackToneAlpha(tone) {
  return TONE_ALPHA[tone] || TONE_ALPHA.medium;
}

// 占位落墨：契约兼容的最小自由笔 + 墨块点按，只在真引擎不可用时启用。
function createFallbackInk(options) {
  const opts = options || {};
  const canvas = opts.canvas;
  const ctx = canvas.getContext('2d');
  const palette = Array.isArray(opts.palette) && opts.palette.length ? opts.palette : ['#26221c'];
  const strokes = [];
  const listeners = [];
  let colorIndex = typeof opts.defaultColor === 'number' ? opts.defaultColor : 0;
  let tone = 'medium';
  let brushSize = 1;
  let tool = 'brush';
  let interactive = opts.interactive !== false;
  let destroyed = false;
  let active = null;
  let dpr = 1;
  let stats = { strokes: 0, stamps: 0, ms: 0, inkCoverage: 0 };
  let firstStrokeFired = false;

  function emit() {
    if (typeof opts.onChange === 'function') {
      try {
        opts.onChange({ strokes: stats.strokes, stamps: stats.stamps, ms: stats.ms });
      } catch (err) {
        /* ignore */
      }
    }
  }

  function setup() {
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width || canvas.clientWidth || window.innerWidth));
    const cssH = Math.max(1, Math.round(rect.height || canvas.clientHeight || window.innerHeight));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    redraw();
  }

  function drawStroke(stroke) {
    if (!stroke || !stroke.points || stroke.points.length === 0) return;
    const color = palette[stroke.color % palette.length];
    const alpha = fallbackToneAlpha(stroke.tone);
    if (stroke.tool === 'stamp') {
      const p = stroke.points[0];
      const radius = Math.max(6, 15 * stroke.size * dpr);
      const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      gradient.addColorStop(0, color);
      gradient.addColorStop(0.7, color);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save();
      ctx.globalAlpha = alpha * 1.4;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1, brushSize * 5 * dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const points = stroke.points;
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < strokes.length; i += 1) drawStroke(strokes[i]);
  }

  function pointFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
    const y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
    return { x, y };
  }

  function onPointerDown(event) {
    if (!interactive || destroyed) return;
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    if (typeof canvas.setPointerCapture === 'function') {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (err) {
        /* ignore */
      }
    }
    active = {
      tool,
      color: colorIndex,
      tone,
      size: brushSize,
      points: [pointFromEvent(event)],
      startedAt: Date.now()
    };
    if (!firstStrokeFired) {
      firstStrokeFired = true;
      if (typeof opts.onFirstStroke === 'function') {
        try {
          opts.onFirstStroke();
        } catch (err) {
          /* ignore */
        }
      }
    }
    redraw();
    drawStroke(active);
  }

  function onPointerMove(event) {
    if (!active || !interactive || destroyed) return;
    event.preventDefault();
    const point = pointFromEvent(event);
    const last = active.points[active.points.length - 1];
    if (Math.abs(point.x - last.x) + Math.abs(point.y - last.y) < 2) return;
    active.points.push(point);
    drawStroke({ points: [last, point], tool: active.tool, color: active.color, tone: active.tone, size: active.size });
  }

  function finishStroke(event) {
    if (!active || destroyed) return;
    if (event && typeof canvas.releasePointerCapture === 'function') {
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch (err) {
        /* ignore */
      }
    }
    const finished = active;
    active = null;
    if (finished.points.length > 0) {
      strokes.push(finished);
      if (strokes.length > FALLBACK_MAX_STROKES) strokes.shift();
      if (finished.tool === 'stamp') stats.stamps += 1;
      else stats.strokes += 1;
      stats.ms += Math.max(0, Date.now() - finished.startedAt);
      stats.inkCoverage = Math.min(1, strokes.length / 40);
      redraw();
      emit();
    }
  }

  function bind(type, handler, target) {
    const host = target || canvas;
    host.addEventListener(type, handler);
    listeners.push({ host, type, handler });
  }

  bind('pointerdown', onPointerDown);
  bind('pointermove', onPointerMove);
  bind('pointerup', finishStroke);
  bind('pointercancel', finishStroke);
  bind('pointerleave', finishStroke);

  setup();

  return {
    canvas,
    setup,
    setTool(nextTool) {
      tool = nextTool === 'stamp' ? 'stamp' : 'brush';
    },
    setTone(nextTone) {
      tone = LINE_TONES.indexOf(nextTone) >= 0 ? nextTone : 'medium';
    },
    setColor(index) {
      colorIndex = Math.max(0, Math.round(Number(index) || 0));
    },
    setSize(nextSize) {
      const n = Number(nextSize);
      brushSize = Number.isFinite(n) ? Math.min(2, Math.max(0.5, n)) : 1;
    },
    setRotation() {},
    setStamp() {},
    undo() {
      if (!strokes.length) return;
      const removed = strokes.pop();
      if (removed.tool === 'stamp') stats.stamps = Math.max(0, stats.stamps - 1);
      else stats.strokes = Math.max(0, stats.strokes - 1);
      stats.inkCoverage = Math.min(1, strokes.length / 40);
      redraw();
      emit();
    },
    clear() {
      strokes.length = 0;
      active = null;
      stats = { strokes: 0, stamps: 0, ms: 0, inkCoverage: 0 };
      redraw();
      emit();
    },
    hasInk() {
      return strokes.length > 0;
    },
    stats() {
      return { strokes: stats.strokes, stamps: stats.stamps, ms: stats.ms, inkCoverage: stats.inkCoverage };
    },
    toDataURL(type) {
      return canvas.toDataURL(type || 'image/png');
    },
    setInteractive(next) {
      interactive = next !== false;
    },
    resize() {
      setup();
    },
    destroy() {
      destroyed = true;
      for (let i = 0; i < listeners.length; i += 1) {
        listeners[i].host.removeEventListener(listeners[i].type, listeners[i].handler);
      }
      listeners.length = 0;
    }
  };
}
// ============ 主控制器 ============

export function createJourney(options) {
  const opts = options || {};
  const stage = opts.stage || qs('#stage');
  const backdrop = opts.backdrop || null;
  const onChange = typeof opts.onChange === 'function' ? opts.onChange : null;

  let session = opts.session || createSession();
  let currentStep = null;
  let screenNode = null;
  let inkState = null;
  let revealState = null;
  let saving = false;
  let savedInfo = null;
  let saveKey = null;
  let resizeTimer = null;

  function emit() {
    if (typeof onChange === 'function') {
      try {
        onChange(session);
      } catch (err) {
        /* ignore */
      }
    }
  }

  // ---------- 背景 ----------

  function sceneOf(id) {
    return findScene(id);
  }

  function currentScene() {
    return findScene(session.sceneId);
  }

  function bgForStep(step) {
    if (step === 'enter' || step === 'pre' || step === 'scene') {
      return CONTENT.entry ? CONTENT.entry.bg : null;
    }
    const scene = currentScene();
    return scene ? scene.bg : CONTENT.entry ? CONTENT.entry.bg : null;
  }

  function warmBackgrounds(step) {
    const current = bgForStep(step);
    if (current) preloadBackground(current);
    const next = nextStepOf(step);
    if (next) {
      const nextBg = bgForStep(next);
      if (nextBg) preloadBackground(nextBg);
    }
    if (step === 'scene') {
      const scenes = CONTENT.scenes || [];
      for (let i = 0; i < scenes.length; i += 1) preloadThumb(scenes[i].bg && scenes[i].bg.thumb);
    }
  }

  function applyBackdrop(step, renderOpts) {
    if (!backdrop) return;
    const bg = bgForStep(step);
    const position = (bg && bg.position) || '';
    backdrop.setSource(bg, { position, immediate: Boolean(renderOpts && renderOpts.immediate) });
  }

  // ---------- 屏切换 ----------

  function showScreen(node, step, renderOpts) {
    const immediate = Boolean(renderOpts && renderOpts.immediate) || reducedMotion();
    node.classList.add('screen');
    node.dataset.step = step;
    if (!node.getAttribute('tabindex')) node.setAttribute('tabindex', '-1');
    const old = screenNode;
    if (stage) stage.appendChild(node);
    screenNode = node;
    if (immediate) {
      node.classList.add('is-ready');
    } else {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (node.isConnected) node.classList.add('is-ready');
        });
      });
    }
    if (old) {
      old.classList.remove('is-ready');
      old.classList.add('is-leaving');
      if (immediate) {
        if (old.parentNode) old.parentNode.removeChild(old);
      } else {
        window.setTimeout(() => {
          if (old.parentNode) old.parentNode.removeChild(old);
        }, motionMs(1500));
      }
    }
    window.setTimeout(() => {
      if (!node.isConnected) return;
      focusNode(node);
      const titleNode = node.querySelector('.screen-title, .museum-title');
      if (titleNode && titleNode.textContent) announce(titleNode.textContent);
      if (typeof node.__onShown === 'function') {
        try {
          node.__onShown();
        } catch (err) {
          /* ignore */
        }
      }
    }, immediate ? 0 : 160);
  }

  function captureInkSnapshot(state) {
    const canvas = state.canvas;
    if (!canvas || canvas.width < 2 || canvas.height < 2) return;
    state.cssWidth = canvas.clientWidth || window.innerWidth;
    state.cssHeight = canvas.clientHeight || window.innerHeight;
    try {
      const snapshot = document.createElement('canvas');
      snapshot.width = canvas.width;
      snapshot.height = canvas.height;
      const snapshotCtx = snapshot.getContext('2d');
      if (!snapshotCtx) return;
      snapshotCtx.drawImage(canvas, 0, 0);
      state.snapshot = snapshot;
    } catch (err) {
      /* ignore */
    }
  }

  function goTo(step, navOptions) {
    const optionsNext = navOptions || {};
    if (!optionsNext.force) {
      if (step === session.step) return false;
      if (!isValidTransition(session.step, step)) return false;
    }
    if (session.step === 'ink' && step !== 'ink' && inkState) {
      captureInkSnapshot(inkState);
    }
    if (session.step === 'ink' && inkState && inkState.engine && typeof inkState.engine.setInteractive === 'function') {
      try {
        inkState.engine.setInteractive(false);
      } catch (err) {
        /* ignore */
      }
    }
    session.step = step;
    renderStep(optionsNext);
    emit();
    return true;
  }

  function renderStep(renderOpts) {
    const rOpts = renderOpts || {};
    const step = session.step;
    currentStep = step;
    setBodyStep(step);
    applyBackdrop(step, rOpts);
    warmBackgrounds(step);
    let node = null;
    if (step === 'enter') node = renderEnter();
    else if (step === 'pre') node = renderPre();
    else if (step === 'scene') node = renderScene();
    else if (step === 'line') node = renderLine();
    else if (step === 'ink') node = renderInk();
    else if (step === 'post') node = renderPost();
    else if (step === 'reveal') node = renderReveal();
    if (!node) node = renderEnter();
    showScreen(node, step, rOpts);
  }

  function makeBackButton(target) {
    const label = (CONTENT.ui && CONTENT.ui.back) || '';
    const node = button(label, { class: 'screen-back', ariaLabel: label });
    node.addEventListener('click', () => {
      const prev = target || backStep(session.step);
      if (prev) goTo(prev);
    });
    return node;
  }

  function makeHead(signText, titleText, hintText) {
    const box = el('div', { class: 'screen-head' });
    if (signText) box.appendChild(el('p', { class: 'sign', text: signText }));
    if (titleText) box.appendChild(el('h2', { class: 'screen-title', text: titleText }));
    if (hintText) box.appendChild(el('p', { class: 'hint', text: hintText }));
    return box;
  }

  // ---------- enter ----------

  function renderEnter() {
    const museum = CONTENT.museum || {};
    const entry = CONTENT.entry || {};
    const ethics = CONTENT.ethics || {};
    const node = el('section', { class: 'screen screen--enter' });
    const enterButton = button(museum.enter || '', { class: 'btn btn--primary' });
    enterButton.addEventListener('click', () => goTo('pre'));
    node.appendChild(
      el('div', { class: 'enter-head' }, [
        el('p', { class: 'kicker', text: museum.kicker || '' }),
        el('h1', { class: 'museum-title', text: museum.title || '' }),
        el('p', { class: 'museum-sub', text: museum.subtitle || '' }),
        el('div', { class: 'enter-actions' }, [
          enterButton,
          entry.hint ? el('p', { class: 'hint', text: entry.hint }) : null
        ])
      ])
    );
    node.appendChild(
      el('div', { class: 'enter-foot' }, [
        el('p', { class: 'enter-credit', text: entry.credit || '' }),
        el('p', { class: 'enter-ethics', text: ethics.short || '' })
      ])
    );
    return node;
  }

  // ---------- 三滑杆 ----------

  function buildScaleGroup(phase, onUpdate) {
    const data = phase === 'pre' ? CONTENT.pre || {} : CONTENT.post || {};
    const items = (CONTENT.pre && CONTENT.pre.items) || [];
    const group = el('div', { class: 'scales', role: 'group', 'aria-label': data.title || data.sign || '' });
    const touched = new Set();

    function refresh() {
      if (typeof onUpdate === 'function') onUpdate();
    }

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const key = item.key || SCALE_KEYS[i];
      const stored = normalizeScale(session[phase] && session[phase][key]);
      let initial = stored;
      if (initial === null && phase === 'post') initial = normalizeScale(session.pre && session.pre[key]);
      if (initial === null) initial = 4;
      const inputId = phase + '-' + key;
      const input = el('input', {
        type: 'range',
        min: 1,
        max: 7,
        step: 1,
        id: inputId,
        'aria-label': item.label || '',
        'aria-valuetext': scaleValueText(item, initial)
      });
      input.value = String(initial);
      const fill = () => {
        input.style.setProperty('--fill', (((Number(input.value) - 1) / 6) * 100).toFixed(1) + '%');
      };
      fill();
      const scale = el('div', { class: 'scale' + (stored !== null ? ' is-touched' : '') }, [
        el('label', { class: 'scale-label', for: inputId, text: item.label || '' }),
        input,
        el('div', { class: 'scale-ends', 'aria-hidden': 'true' }, [
          el('span', { text: (data.ends || (CONTENT.pre && CONTENT.pre.ends) || [])[0] || '' }),
          el('span', { text: (data.ends || (CONTENT.pre && CONTENT.pre.ends) || [])[1] || '' })
        ])
      ]);
      if (stored !== null) touched.add(key);
      input.addEventListener('input', () => {
        const value = normalizeScale(input.value) || 4;
        if (!session[phase]) session[phase] = { tight: null, tired: null, scattered: null };
        session[phase][key] = value;
        touched.add(key);
        scale.classList.add('is-touched');
        input.setAttribute('aria-valuetext', scaleValueText(item, value));
        fill();
        refresh();
        emit();
      });
      group.appendChild(scale);
    }

    return {
      node: group,
      touched,
      isComplete() {
        return touched.size >= items.length;
      }
    };
  }

  // ---------- pre ----------

  function renderPre() {
    const data = CONTENT.pre || {};
    const node = el('section', { class: 'screen screen--pre' });
    if (canGoBack('pre')) node.appendChild(makeBackButton('enter'));
    const head = makeHead(data.sign, data.title, null);
    head.classList.add('pre-head');
    const nextButton = button(data.next || '', { class: 'btn btn--primary' });
    nextButton.disabled = true;
    function refresh() {
      nextButton.disabled = !group.isComplete();
    }
    const group = buildScaleGroup('pre', refresh);
    refresh();
    nextButton.addEventListener('click', () => goTo('scene'));
    node.appendChild(head);
    node.appendChild(group.node);
    if (data.hint) node.appendChild(el('p', { class: 'hint', text: data.hint }));
    node.appendChild(nextButton);
    return node;
  }

  // ---------- scene ----------

  function renderScene() {
    const data = CONTENT.scene || {};
    const node = el('section', { class: 'screen screen--scene' });
    if (canGoBack('scene')) node.appendChild(makeBackButton('pre'));
    const head = makeHead(data.sign, data.title, null);
    const grid = el('ul', { class: 'scene-grid' });
    const scenes = CONTENT.scenes || [];
    for (let i = 0; i < scenes.length; i += 1) {
      const scene = scenes[i];
      const work = scene.work || {};
      const frame = el('span', { class: 'scene-frame' });
      const img = el('img', {
        src: (scene.bg && scene.bg.thumb) || '',
        alt: '',
        width: 640,
        height: 420,
        loading: 'lazy',
        decoding: 'async'
      });
      img.addEventListener('load', () => frame.classList.add('is-loaded'));
      img.addEventListener('error', () => frame.classList.add('is-missing'));
      if (img.complete && img.naturalWidth > 0) frame.classList.add('is-loaded');
      frame.appendChild(img);
      const meta = el('span', { class: 'scene-meta' }, [
        el('span', { class: 'scene-name', text: scene.name || '' }),
        el('span', {
          class: 'scene-work',
          text: [work.dynasty, work.artist].filter((part) => part && part.length).join(' · ')
        })
      ]);
      const card = el(
        'button',
        {
          class: 'scene-card',
          type: 'button',
          'aria-label': [scene.name, work.title, work.dynasty, work.artist].filter((part) => part && part.length).join(' ')
        },
        [frame, meta]
      );
      card.addEventListener('click', () => {
        session.sceneId = scene.id;
        session.line = { answer: null, round: 0 };
        session.ink = { strokes: 0, stamps: 0, ms: 0 };
        session.post = { tight: null, tired: null, scattered: null, mood: null };
        emit();
        goTo('line');
      });
      grid.appendChild(el('li', {}, [card]));
    }
    node.appendChild(head);
    node.appendChild(grid);
    return node;
  }

  // ---------- line ----------

  function renderLine() {
    const scene = currentScene();
    if (!scene) {
      session.step = 'scene';
      return renderScene();
    }
    const data = CONTENT.line || {};
    const node = el('section', { class: 'screen screen--line' });
    if (canGoBack('line')) node.appendChild(makeBackButton('scene'));

    const opening = (scene.opening && scene.opening[0]) || '';
    const closing = (scene.closing && scene.closing[0]) || '';
    const textNode = el('p', { class: 'line-text' });
    const stageBox = el('div', { class: 'line-stage' });
    stageBox.appendChild(el('p', { class: 'sign', text: data.sign || '' }));
    stageBox.appendChild(textNode);

    const repliesBox = el('div', { class: 'replies', role: 'group', 'aria-label': data.sign || '' });
    const nextWrap = el('div', { class: 'line-next' });
    const nextButton = button(data.next || '', { class: 'btn btn--primary' });
    nextWrap.appendChild(nextButton);
    nextButton.addEventListener('click', () => goTo('ink'));

    const replyButtons = [];
    const replies = CONTENT.line && CONTENT.line.replies ? CONTENT.line.replies : [];
    function selectReply(key) {
      for (let i = 0; i < replyButtons.length; i += 1) {
        replyButtons[i].setAttribute('aria-pressed', replyButtons[i].dataset.reply === key ? 'true' : 'false');
      }
    }
    for (let i = 0; i < replies.length; i += 1) {
      const reply = replies[i];
      const replyButton = button(reply.label || '', { class: 'reply', pressed: session.line.answer === reply.key });
      replyButton.dataset.reply = reply.key;
      replyButton.addEventListener('click', () => {
        session.line.answer = reply.key;
        session.line.round = 1;
        selectReply(reply.key);
        nextWrap.classList.add('is-visible');
        if (closing && textNode.textContent !== closing) {
          textNode.classList.remove('is-visible');
          window.setTimeout(() => {
            if (!textNode.isConnected) return;
            textNode.textContent = closing;
            textNode.classList.add('is-visible');
            announce(closing);
          }, motionMs(520));
        }
        emit();
      });
      replyButtons.push(replyButton);
      repliesBox.appendChild(replyButton);
    }

    stageBox.appendChild(repliesBox);
    stageBox.appendChild(nextWrap);
    node.appendChild(stageBox);

    textNode.textContent = session.line.round === 1 && closing ? closing : opening;
    if (session.line.round === 1 && session.line.answer) nextWrap.classList.add('is-visible');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (textNode.isConnected) textNode.classList.add('is-visible');
      });
    });
    return node;
  }

  // ---------- ink ----------

  function destroyInkState() {
    if (!inkState) return;
    if (inkState.engine && typeof inkState.engine.destroy === 'function') {
      try {
        inkState.engine.destroy();
      } catch (err) {
        /* ignore */
      }
    }
    if (inkState.canvas && inkState.canvas.parentNode) inkState.canvas.parentNode.removeChild(inkState.canvas);
    inkState = null;
  }

  function createInkInstance(state, scene) {
    const palette = (scene.ink && scene.ink.palette) || ['#26221c'];
    const engineOptions = {
      canvas: state.canvas,
      masksUrl: 'data/masks.json',
      palette,
      defaultColor: (scene.ink && scene.ink.defaultColor) || 0,
      interactive: true,
      onFirstStroke() {
        if (inkState && inkState.head) inkState.head.classList.add('is-dim');
      },
      onChange(stats) {
        if (!stats) return;
        session.ink = {
          strokes: Math.max(0, Math.round(Number(stats.strokes) || 0)),
          stamps: Math.max(0, Math.round(Number(stats.stamps) || 0)),
          ms: Math.max(0, Math.round(Number(stats.ms) || 0))
        };
        refreshInkButtons();
        emit();
      }
    };
    let instance = null;
    try {
      instance = createInkEngine(engineOptions);
    } catch (err) {
      instance = null;
    }
    const usable =
      instance &&
      typeof instance.setTool === 'function' &&
      typeof instance.undo === 'function' &&
      typeof instance.hasInk === 'function' &&
      typeof instance.toDataURL === 'function';
    if (!usable) {
      if (instance && typeof instance.destroy === 'function') {
        try {
          instance.destroy();
        } catch (err) {
          /* ignore */
        }
      }
      instance = createFallbackInk(engineOptions);
    }
    state.engine = instance;
    try {
      instance.setTool(state.tool);
      instance.setTone(state.tone);
      instance.setSize(state.size);
    } catch (err) {
      /* ignore */
    }
    return instance;
  }

  function ensureInkState(scene) {
    if (inkState && inkState.sceneId === scene.id) return inkState;
    if (inkState) destroyInkState();
    const canvas = el('canvas', {
      class: 'ink-canvas',
      'aria-label': (CONTENT.ink && CONTENT.ink.title) || ''
    });
    inkState = {
      sceneId: scene.id,
      canvas,
      engine: null,
      tool: 'brush',
      tone: 'medium',
      size: 1,
      head: null,
      undoBtn: null,
      clearBtn: null,
      snapshot: null,
      cssWidth: 0,
      cssHeight: 0
    };
    return inkState;
  }

  function inkEngine() {
    if (!inkState) return null;
    if (inkState.engine) return inkState.engine;
    const scene = currentScene();
    if (!scene) return null;
    return createInkInstance(inkState, scene);
  }

  function syncInkStats() {
    if (!inkState || !inkState.engine || typeof inkState.engine.stats !== 'function') return;
    try {
      const stats = inkState.engine.stats();
      if (!stats) return;
      session.ink = {
        strokes: Math.max(0, Math.round(Number(stats.strokes) || 0)),
        stamps: Math.max(0, Math.round(Number(stats.stamps) || 0)),
        ms: Math.max(0, Math.round(Number(stats.ms) || 0))
      };
      emit();
    } catch (err) {
      /* ignore */
    }
  }

  function refreshInkButtons() {
    if (!inkState) return;
    let hasInk = false;
    try {
      hasInk = Boolean(inkState.engine && typeof inkState.engine.hasInk === 'function' && inkState.engine.hasInk());
    } catch (err) {
      hasInk = false;
    }
    if (inkState.undoBtn) inkState.undoBtn.disabled = !hasInk;
    if (inkState.clearBtn) inkState.clearBtn.disabled = !hasInk;
  }

  function buildInkToolbar(state) {
    const ui = CONTENT.ui || {};
    const ink = CONTENT.ink || {};
    const bar = el('div', { class: 'ink-bar', role: 'toolbar', 'aria-label': ink.sign || '' });

    const toolGroup = el('div', { class: 'seg', role: 'group', 'aria-label': ui.brush || '' });
    const brushBtn = button(ui.brush || '', { class: 'seg-btn', pressed: state.tool === 'brush' });
    const stampBtn = button(ui.stamp || '', { class: 'seg-btn', pressed: state.tool === 'stamp' });
    function selectTool(tool) {
      state.tool = tool;
      brushBtn.setAttribute('aria-pressed', tool === 'brush' ? 'true' : 'false');
      stampBtn.setAttribute('aria-pressed', tool === 'stamp' ? 'true' : 'false');
      const engine = inkEngine();
      if (engine && typeof engine.setTool === 'function') engine.setTool(tool);
    }
    brushBtn.addEventListener('click', () => selectTool('brush'));
    stampBtn.addEventListener('click', () => selectTool('stamp'));
    toolGroup.appendChild(brushBtn);
    toolGroup.appendChild(stampBtn);

    const toneLabels = ui.tone || [];
    const toneGroup = el('div', { class: 'seg', role: 'group', 'aria-label': ui.tone ? ui.tone.join(' / ') : '' });
    const toneButtons = [];
    for (let i = 0; i < LINE_TONES.length; i += 1) {
      const toneKey = LINE_TONES[i];
      const toneBtn = button(toneLabels[i] || '', { class: 'seg-btn', pressed: state.tone === toneKey });
      toneBtn.addEventListener('click', () => {
        state.tone = toneKey;
        for (let j = 0; j < toneButtons.length; j += 1) {
          toneButtons[j].setAttribute('aria-pressed', LINE_TONES[j] === toneKey ? 'true' : 'false');
        }
        const engine = inkEngine();
        if (engine && typeof engine.setTone === 'function') engine.setTone(toneKey);
      });
      toneButtons.push(toneBtn);
      toneGroup.appendChild(toneBtn);
    }

    const sizeField = el('label', { class: 'size-field' });
    sizeField.appendChild(el('span', { text: ui.size || '' }));
    const sizeInput = el('input', {
      type: 'range',
      min: 0.5,
      max: 2,
      step: 0.1,
      value: '1',
      'aria-label': ui.size || ''
    });
    sizeInput.value = '1';
    sizeInput.addEventListener('input', () => {
      const value = Number(sizeInput.value);
      state.size = Number.isFinite(value) ? value : 1;
      const engine = inkEngine();
      if (engine && typeof engine.setSize === 'function') engine.setSize(state.size);
    });
    sizeField.appendChild(sizeInput);

    const undoBtn = button(ui.undo || '', { class: 'tool-btn' });
    undoBtn.disabled = true;
    undoBtn.addEventListener('click', () => {
      const engine = inkEngine();
      if (!engine) return;
      engine.undo();
      syncInkStats();
      refreshInkButtons();
    });

    const clearBtn = button(ui.clear || '', { class: 'tool-btn' });
    clearBtn.disabled = true;
    clearBtn.addEventListener('click', () => {
      const engine = inkEngine();
      if (!engine) return;
      engine.clear();
      syncInkStats();
      refreshInkButtons();
    });

    state.undoBtn = undoBtn;
    state.clearBtn = clearBtn;

    const finishWrap = el('div', { class: 'ink-finish' });
    if (ink.noInk) finishWrap.appendChild(el('span', { class: 'ink-note', text: ink.noInk }));
    const finishBtn = button(ink.finish || CONTENT.ink.finish || '', { class: 'btn btn--primary' });
    finishBtn.addEventListener('click', () => goTo('post'));
    finishWrap.appendChild(finishBtn);

    bar.appendChild(toolGroup);
    bar.appendChild(toneGroup);
    bar.appendChild(sizeField);
    bar.appendChild(undoBtn);
    bar.appendChild(clearBtn);
    bar.appendChild(finishWrap);
    return bar;
  }

  function renderInk() {
    const scene = currentScene();
    if (!scene) {
      session.step = 'scene';
      return renderScene();
    }
    const state = ensureInkState(scene);
    const node = el('section', { class: 'screen screen--ink' });
    const ink = CONTENT.ink || {};
    const head = el('div', { class: 'ink-head' }, [
      el('p', { class: 'sign', text: ink.sign || '' }),
      el('h2', { class: 'screen-title', text: ink.title || '' }),
      ink.hint ? el('p', { class: 'hint', text: ink.hint }) : null
    ]);
    state.head = head;
    node.appendChild(head);
    node.appendChild(state.canvas);
    node.appendChild(el('div', { class: 'ink-toolbar' }, [buildInkToolbar(state)]));
    node.appendChild(makeBackButton('line'));

    node.__onShown = () => {
      const engine = inkEngine();
      if (engine) {
        try {
          engine.setInteractive(true);
          if (typeof engine.resize === 'function') engine.resize();
        } catch (err) {
          /* ignore */
        }
      }
      refreshInkButtons();
    };
    return node;
  }

  // ---------- post ----------

  function renderPost() {
    const data = CONTENT.post || {};
    const node = el('section', { class: 'screen screen--post' });
    if (canGoBack('post')) node.appendChild(makeBackButton('ink'));
    const head = makeHead(data.sign, data.title, null);
    head.classList.add('post-head');

    const panel = el('div', { class: 'post-panel' });
    const nextButton = button(data.next || '', { class: 'btn btn--primary' });
    nextButton.disabled = true;
    let mood = session.post && session.post.mood ? session.post.mood : null;
    let group = null;

    function refresh() {
      nextButton.disabled = !(group && group.isComplete() && Boolean(mood));
    }

    group = buildScaleGroup('post', refresh);

    const moodBlock = el('div', { class: 'mood-block' });
    if (data.moodLabel) moodBlock.appendChild(el('p', { class: 'mood-label', text: data.moodLabel }));
    const moodsBox = el('div', { class: 'moods', role: 'group', 'aria-label': data.moodLabel || '' });
    const moodButtons = [];
    const moods = data.moods || [];
    for (let i = 0; i < moods.length; i += 1) {
      const moodItem = moods[i];
      const moodButton = button(moodItem.label || '', { class: 'mood', pressed: mood === moodItem.key });
      moodButton.dataset.mood = moodItem.key;
      moodButton.addEventListener('click', () => {
        mood = moodItem.key;
        session.post.mood = mood;
        for (let j = 0; j < moodButtons.length; j += 1) {
          moodButtons[j].setAttribute('aria-pressed', moodButtons[j].dataset.mood === mood ? 'true' : 'false');
        }
        refresh();
        emit();
      });
      moodButtons.push(moodButton);
      moodsBox.appendChild(moodButton);
    }
    moodBlock.appendChild(moodsBox);
    panel.appendChild(group.node);
    panel.appendChild(moodBlock);
    panel.appendChild(nextButton);
    if (data.hint) node.appendChild(head);
    else node.appendChild(head);
    node.appendChild(panel);
    refresh();
    nextButton.addEventListener('click', () => goTo('reveal'));
    return node;
  }

  // ---------- reveal ----------

  function renderReveal() {
    const scene = currentScene();
    if (!scene) {
      session.step = 'scene';
      return renderScene();
    }
    if (!session.finishedAt) {
      session.finishedAt = nowIso();
      emit();
    }
    const scroll = CONTENT.scroll || {};
    const node = el('section', { class: 'screen screen--reveal' });
    if (scroll.sign) node.appendChild(el('p', { class: 'sign', text: scroll.sign }));
    if (scroll.title) node.appendChild(el('h2', { class: 'screen-title', text: scroll.title }));

    const frame = el('div', { class: 'reveal-frame' });
    const skeleton = el('div', { class: 'reveal-skeleton' });
    frame.appendChild(skeleton);
    node.appendChild(frame);

    const dots = el('div', { class: 'dots', 'aria-hidden': 'true' });
    const scaleKeysInOrder = CONTENT.pre && CONTENT.pre.items ? CONTENT.pre.items.map((item) => item.key) : [];
    for (let i = 0; i < scaleKeysInOrder.length; i += 1) {
      const key = scaleKeysInOrder[i];
      const before = normalizeScale(session.pre && session.pre[key]);
      const after = normalizeScale(session.post && session.post[key]);
      if (before === null || after === null) continue;
      const dotSize = (value) => 8 + Math.round(((value - 1) / 6) * 4) + 'px';
      const pair = el('span', { class: 'dot-pair' });
      const ghost = el('span', { class: 'dot dot--ghost' });
      ghost.style.setProperty('--dot-size', dotSize(before));
      const inkDot = el('span', { class: 'dot dot--ink' });
      inkDot.style.setProperty('--dot-size', dotSize(after));
      pair.appendChild(ghost);
      pair.appendChild(inkDot);
      dots.appendChild(pair);
    }
    const changeBox = el('div', { class: 'change' });
    if (scroll.changeLabel) changeBox.appendChild(el('p', { class: 'change-label', text: scroll.changeLabel }));
    changeBox.appendChild(dots);
    node.appendChild(changeBox);

    const delta = computeDelta(session.pre, session.post);
    const feedbackText = pickFeedback(
      delta,
      CONTENT.feedback,
      String(session.clientId || '') + '|' + String(session.startedAt || '') + '|' + String(session.sceneId || '')
    );
    node.appendChild(el('p', { class: 'feedback', text: feedbackText || scroll.noChange || '' }));

    const actions = el('div', { class: 'actions reveal-actions' });
    const saveBtn = button(scroll.save || '', { class: 'btn btn--primary' });
    const downloadBtn = button(scroll.download || '', { class: 'btn' });
    const againBtn = button(scroll.again || '', { class: 'btn btn--text' });
    actions.appendChild(saveBtn);
    actions.appendChild(downloadBtn);
    actions.appendChild(againBtn);
    node.appendChild(actions);
    if (scroll.hint) node.appendChild(el('p', { class: 'scroll-hint', text: scroll.hint }));

    const work = scene.work || {};
    const previewAlt = [work.title, work.artist].filter((part) => part && part.length).join(' ');
    let composed = null;

    function applySaved(mode) {
      savedInfo = mode;
      saveBtn.disabled = true;
      saveBtn.setAttribute('aria-disabled', 'true');
      saveBtn.setAttribute('aria-busy', 'false');
      saveBtn.textContent = mode === 'server' ? scroll.saved || '' : scroll.saveLocal || '';
    }

    async function handleSave() {
      if (saving || savedInfo) return;
      if (!composed || !composed.dataUrl) {
        toast(scroll.saveFail || '');
        return;
      }
      saving = true;
      saveBtn.disabled = true;
      saveBtn.setAttribute('aria-busy', 'true');
      let serverDone = false;
      try {
        const payload = buildPayload(session, composed.dataUrl, session.post.mood);
        await ensureApiMode();
        if (currentApiMode() === 'server') {
          if (!saveKey) saveKey = makeIdempotencyKey();
          await saveScroll(payload, saveKey);
          applySaved('server');
          toast(scroll.saved || '');
          announce(scroll.saved || '');
          serverDone = true;
        }
      } catch (err) {
        serverDone = false;
      }
      if (!serverDone) {
        try {
          let image = composed.dataUrl;
          try {
            image = await compactScrollDataUrl(composed.dataUrl, 1400, 0.72);
          } catch (err) {
            image = composed.dataUrl;
          }
          const item = {
            id: makeLocalId(),
            sceneId: session.sceneId,
            mood: session.post.mood,
            createdAt: nowIso(),
            image,
            schemaVersion: session.schemaVersion,
            source: 'local'
          };
          const result = saveLocalScroll(item);
          if (result.ok) {
            applySaved('local');
            toast(scroll.saveLocal || '');
            announce(scroll.saveLocal || '');
          } else {
            saveBtn.disabled = false;
            saveBtn.setAttribute('aria-busy', 'false');
            toast(scroll.saveFail || '');
          }
        } catch (err) {
          saveBtn.disabled = false;
          saveBtn.setAttribute('aria-busy', 'false');
          toast(scroll.saveFail || '');
        }
      }
      saving = false;
    }

    saveBtn.addEventListener('click', handleSave);

    downloadBtn.addEventListener('click', () => {
      if (!composed || !composed.dataUrl) return;
      const stamp = formatDate(new Date()).replace(/[.]/g, '-');
      downloadDataUrl(composed.dataUrl, 'ink-museum-' + (session.sceneId || 'scroll') + '-' + stamp);
    });

    againBtn.addEventListener('click', () => {
      revealState = null;
      destroyInkState();
      session = resetForReplay(session);
      renderStep({ immediate: false });
      emit();
      announce((CONTENT.scene && CONTENT.scene.title) || '');
    });

    node.__onShown = () => {
      let cssWidth = window.innerWidth;
      let cssHeight = window.innerHeight;
      let inkCanvas = null;
      if (inkState) {
        inkCanvas = inkState.snapshot || inkState.canvas;
        if (inkState.cssWidth) cssWidth = inkState.cssWidth;
        if (inkState.cssHeight) cssHeight = inkState.cssHeight;
      }
      const bgImg = backdrop && typeof backdrop.getFrontImage === 'function' ? backdrop.getFrontImage() : null;
      let seed = 0;
      const seedText = String(session.clientId || '') + String(session.startedAt || '');
      for (let i = 0; i < seedText.length; i += 1) seed = (seed * 31 + seedText.charCodeAt(i)) >>> 0;
      let result = null;
      try {
        result = composeScroll({
          bgImg,
          inkCanvas,
          cssWidth,
          cssHeight,
          scene,
          content: CONTENT,
          date: new Date(),
          seed
        });
      } catch (err) {
        result = null;
      }
      revealState = result;
      if (!result || !result.dataUrl) {
        saveBtn.disabled = true;
        downloadBtn.disabled = true;
        return;
      }
      composed = result;
      const preview = el('img', { class: 'scroll-preview', alt: previewAlt, decoding: 'async' });
      preview.addEventListener('load', () => {
        if (!node.isConnected) return;
        if (skeleton.parentNode) skeleton.parentNode.removeChild(skeleton);
        frame.appendChild(preview);
        requestAnimationFrame(() => preview.classList.add('is-ready'));
      });
      preview.addEventListener('error', () => {
        saveBtn.disabled = true;
        downloadBtn.disabled = true;
      });
      preview.src = result.dataUrl;
    };
    return node;
  }

  // ---------- 生命周期 ----------

  function onWindowResize() {
    if (resizeTimer) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (currentStep === 'ink' && inkState && inkState.engine && typeof inkState.engine.resize === 'function') {
        try {
          inkState.engine.resize();
        } catch (err) {
          /* ignore */
        }
      }
    }, 180);
  }

  window.addEventListener('resize', onWindowResize);
  window.addEventListener('orientationchange', onWindowResize);

  function start(startOpts) {
    renderStep(Object.assign({ immediate: true }, startOpts || {}));
    emit();
  }

  function refresh(forceStep) {
    if (forceStep) session.step = forceStep;
    session.step = guardStep(session, session.step);
    renderStep({ immediate: true });
    emit();
  }

  function resetAllState() {
    destroyInkState();
    revealState = null;
    savedInfo = null;
    saveKey = null;
    const previousClientId = session.clientId;
    session = createSession();
    session.clientId = previousClientId;
    renderStep({ immediate: false });
    emit();
  }

  function destroy() {
    window.removeEventListener('resize', onWindowResize);
    window.removeEventListener('orientationchange', onWindowResize);
    destroyInkState();
    if (screenNode && screenNode.parentNode) screenNode.parentNode.removeChild(screenNode);
    screenNode = null;
  }

  return {
    start,
    goTo,
    refresh,
    resetAllState,
    destroy,
    getSession() {
      return session;
    },
    setSession(next) {
      session = next;
    },
    getStep() {
      return currentStep;
    }
  };
}
