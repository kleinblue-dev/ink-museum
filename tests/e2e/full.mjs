// 墨馆 ink-museum · 最终验收 suite=full（SPEC §8 九条验收门）
// 由 tests/e2e/run.mjs --suite=full 调用。自己 spawn 干净服务（临时 DATA_DIR + 放宽限流），
// 不修改产品代码；所有断言进 result.checks，证据落 _qa-artifacts/final/。

import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import {
  PROJECT_ROOT,
  InfraError,
  allowedOriginsFor,
  createCollector,
  launchBrowser,
  nowIso,
  readInstalledVersion,
  rel,
  sleep,
  spawnQaServer,
} from './harness.mjs';

const SERVER_BASE = 'http://127.0.0.1:8793';
const STATIC_BASE = 'http://127.0.0.1:8794';
const SERVER_PORT = 8793;
const STATIC_PORT = 8794;
const SETTLE = 250;
const SCALE_KEYS = ['tight', 'tired', 'scattered'];

const BTN = Object.freeze({
  enter: '入馆',
  preNext: '往里走',
  back: '返回',
  lineNext: '落墨',
  finish: '收笔',
  scrollNext: '收卷',
  save: '存进馆藏',
  gallery: '馆藏',
  about: '关于',
  close: '合上',
  undo: '撤销',
  clear: '重来',
  brush: '笔',
  stamp: '墨块',
});

function addCheck(state, id, description, pass, detail) {
  const entry = { id, description, status: pass ? 'pass' : 'fail', detail: detail || '' };
  state.checks.push(entry);
  if (!pass) state.result.failures.push({ id, description, detail: detail || '' });
  return entry;
}

function note(state, text) {
  state.result.warnings.push(text);
}

async function shot(state, page, name, fullPage = false) {
  const file = path.join(state.outDir, name + '.png');
  try {
    await page.screenshot({ path: file, fullPage });
    state.screenshots.push(rel(file));
  } catch (err) {
    note(state, '截图失败 ' + name + ': ' + String(err && err.message ? err.message : err));
  }
}

async function openTracked(state, label, baseURL, contextOptions = {}) {
  const context = await state.browser.newContext({
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    ...contextOptions,
  });
  const page = await context.newPage();
  const collector = createCollector(page, { allowedOrigins: allowedOriginsFor(baseURL) });
  const entry = { label, context, page, collector, baseURL };
  state.pages.push(entry);
  return entry;
}

async function closeTracked(entry) {
  try { await entry.context.close(); } catch { /* ignore */ }
}

// ---------- 页面动作 ----------

async function waitStep(page, step, timeout = 15000) {
  await page.waitForSelector('body[data-step="' + step + '"]', { timeout });
}

async function clickButton(page, name, options = {}) {
  const { exact = true, timeout = 10000 } = options;
  const loc = page.getByRole('button', { name, exact }).first();
  await loc.waitFor({ state: 'visible', timeout });
  await loc.click();
  return loc;
}

async function readSession(page) {
  return page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('ink-museum.session.v1') || 'null'); } catch (err) { return null; }
  });
}

async function readLocalGallery(page) {
  return page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('ink-museum.gallery.v1') || '[]'); } catch (err) { return []; }
  });
}

async function activeDescriptor(page) {
  return page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return { tag: 'BODY' };
    return {
      tag: a.tagName,
      type: a.type || '',
      id: a.id || '',
      text: String(a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
      aria: a.getAttribute('aria-label') || '',
    };
  });
}

async function tabTo(page, matcher, maxTabs = 80) {
  for (let i = 0; i < maxTabs; i += 1) {
    const d = await activeDescriptor(page);
    if (matcher(d)) return d;
    await page.keyboard.press('Tab');
    await sleep(40);
  }
  throw new Error('tabTo 未找到目标（' + maxTabs + ' 次 Tab）');
}

async function pressEnter(page) {
  await page.keyboard.press('Enter');
  await sleep(120);
}

async function touchScale(page, phase, key) {
  const input = page.locator('input#' + phase + '-' + key).first();
  await input.waitFor({ state: 'visible', timeout: 8000 });
  await input.click();
  await input.press('ArrowRight');
  await sleep(80);
  return Number(await input.inputValue());
}

async function drawStroke(page, from, to, steps = 14) {
  const canvas = page.locator('canvas.ink-canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('ink 画布不可见');
  const x0 = box.x + box.width * (from ? from[0] : 0.34);
  const y0 = box.y + box.height * (from ? from[1] : 0.42);
  const x1 = box.x + box.width * (to ? to[0] : 0.64);
  const y1 = box.y + box.height * (to ? to[1] : 0.56);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
    await sleep(12);
  }
  await page.mouse.up();
  await sleep(SETTLE);
}

async function clickCanvas(page, xRatio, yRatio) {
  const box = await page.locator('canvas.ink-canvas').first().boundingBox();
  if (!box) throw new Error('ink 画布不可见');
  await page.mouse.click(box.x + box.width * xRatio, box.y + box.height * yRatio);
  await sleep(SETTLE);
}

async function canvasSignature(page) {
  return page.evaluate(() => {
    const c = document.querySelector('canvas.ink-canvas');
    if (!c) return { ok: false, len: 0 };
    try {
      const d = c.toDataURL('image/png');
      return { ok: true, len: d.length, head: d.slice(0, 30) };
    } catch (err) {
      return { ok: false, len: 0 };
    }
  });
}

async function currentStep(page) {
  return page.evaluate(() => (document.body && document.body.dataset ? document.body.dataset.step : null));
}

async function visibleButtons(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('button'))
      .filter((b) => b.offsetParent !== null)
      .map((b) => ({
        name: (b.getAttribute('aria-label') || b.textContent || '').replace(/\s+/g, ' ').trim(),
        disabled: Boolean(b.disabled),
        pressed: b.getAttribute('aria-pressed'),
      }))
  );
}

async function rangeInfo(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('input[type="range"]'))
      .filter((i) => i.offsetParent !== null)
      .map((i) => ({
        id: i.id || '',
        ariaLabel: i.getAttribute('aria-label') || '',
        ariaValueText: i.getAttribute('aria-valuetext') || '',
        value: Number(i.value),
        min: Number(i.min),
        max: Number(i.max),
      }))
  );
}

function stripTags(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ');
}

// ---------- 单页事件汇总 ----------

function aggregatePages(state) {
  const consoleErrors = [];
  const pageErrors = [];
  const externalRequests = [];
  const requestFailures = [];
  const failedResponses = [];
  for (const entry of state.pages) {
    for (const e of entry.collector.consoleErrors) consoleErrors.push({ page: entry.label, text: e.text, url: e.url });
    for (const e of entry.collector.pageErrors) pageErrors.push({ page: entry.label, message: e.message });
    for (const e of entry.collector.externalRequests) externalRequests.push({ page: entry.label, url: e.url });
    for (const e of entry.collector.requestFailures) requestFailures.push({ page: entry.label, url: e.url, error: e.errorText });
    for (const e of entry.collector.failedResponses) failedResponses.push({ page: entry.label, url: e.url, status: e.status });
  }
  return { consoleErrors, pageErrors, externalRequests, requestFailures, failedResponses };
}

function finalizeResult(state) {
  const agg = aggregatePages(state);
  state.metrics.consoleErrors = agg.consoleErrors;
  state.metrics.pageErrors = agg.pageErrors;
  state.metrics.externalRequests = agg.externalRequests;
  state.metrics.requestFailures = agg.requestFailures;
  state.metrics.failedResponses = agg.failedResponses;
  const result = state.result;
  addCheck(state, 'console.noErrors', '全部页面控制台无 error', agg.consoleErrors.length === 0, summaryOf(agg.consoleErrors, (e) => e.page + ': ' + e.text));
  addCheck(state, 'page.noPageErrors', '全部页面无未捕获 pageerror', agg.pageErrors.length === 0, summaryOf(agg.pageErrors, (e) => e.page + ': ' + e.message));
  addCheck(state, 'network.zeroExternalRequests', '运行时零外站请求（只允许本站/file/blob/data）', agg.externalRequests.length === 0, summaryOf(agg.externalRequests, (e) => e.page + ': ' + e.url));
  addCheck(state, 'network.noHttpErrors', '无 >=400 的资源响应', agg.failedResponses.length === 0, summaryOf(agg.failedResponses, (e) => e.page + ': ' + e.status + ' ' + e.url));
  result.checks = state.checks;
  result.screenshots = state.screenshots;
  result.metrics = state.metrics;
  result.target = {
    baseURL: SERVER_BASE,
    staticBase: STATIC_BASE,
    targetPath: '/?fresh=1',
    viewports: ['1440x900', '390x844', '320x640'],
    modes: ['server', 'local-static', 'standalone-file'],
  };
  result.artifacts.screenshots = state.screenshots;
}

// ---------- 旅程原子动作 ----------

async function bootApp(entry, baseURL, query) {
  const url = new URL(query || '/?fresh=1', baseURL).href;
  const resp = await entry.page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await waitStep(entry.page, 'enter');
  return resp ? resp.status() : null;
}

async function fetchJsonSafe(url) {
  try {
    const res = await fetch(url);
    const text = await res.text();
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

async function fetchWithStatus(url) {
  try {
    const res = await fetch(url);
    return { ok: res.ok, status: res.status, contentType: res.headers.get('content-type') || '' };
  } catch (err) {
    return { ok: false, status: 0, contentType: '' };
  }
}

async function touchDragCanvas(entry, page) {
  const box = await page.locator('canvas.ink-canvas').first().boundingBox();
  if (!box) return;
  const cdp = await entry.context.newCDPSession(page);
  const x = box.x + box.width * 0.5;
  const y = box.y + box.height * 0.5;
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 4, radiusY: 4, force: 1 }] });
    for (let i = 1; i <= 6; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + i * 6, y, radiusX: 4, radiusY: 4, force: 1 }] });
      await sleep(30);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } catch (err) {
    note({ result: { warnings: [] } }, 'touch 事件发送失败: ' + String(err && err.message ? err.message : err));
  }
  try { await cdp.detach(); } catch { /* ignore */ }
  await sleep(250);
}

async function checkInk(state, page, label) {
  const sigEmpty = await canvasSignature(page);
  await drawStroke(page);
  const sigStroke = await canvasSignature(page);
  const sessionStroke = await readSession(page);
  addCheck(state, 'e2e.ink.canvasDrawn.' + label, label + ' 自由笔落笔后画布有墨', sigStroke.ok && sigStroke.len !== sigEmpty.len, 'dataUrlLen ' + sigEmpty.len + ' -> ' + sigStroke.len);
  addCheck(state, 'e2e.ink.stats.' + label, label + ' 落笔后 session.ink.strokes ≥ 1', Boolean(sessionStroke && sessionStroke.ink && sessionStroke.ink.strokes >= 1), JSON.stringify(sessionStroke && sessionStroke.ink));

  await clickButton(page, BTN.stamp);
  await clickCanvas(page, 0.62, 0.38);
  const sigStamp = await canvasSignature(page);
  const sessionStamp = await readSession(page);
  const stampStats = sessionStamp && sessionStamp.ink ? sessionStamp.ink : null;
  addCheck(state, 'e2e.ink.stamp.' + label, label + ' 墨块点按落墨生效', sigStamp.len !== sigStroke.len || Boolean(stampStats && stampStats.stamps >= 1), 'dataUrlLen ' + sigStroke.len + ' -> ' + sigStamp.len + ' stats=' + JSON.stringify(stampStats));

  const undoBtn = page.getByRole('button', { name: BTN.undo, exact: true }).first();
  const undoEnabled = await undoBtn.isEnabled();
  const totalBeforeUndo = stampStats ? stampStats.strokes + stampStats.stamps : 0;
  await undoBtn.click();
  await sleep(SETTLE);
  const sigUndo = await canvasSignature(page);
  const sessionUndo = await readSession(page);
  const undoStats = sessionUndo && sessionUndo.ink ? sessionUndo.ink : null;
  const totalAfterUndo = undoStats ? undoStats.strokes + undoStats.stamps : 0;
  addCheck(state, 'e2e.ink.undo.' + label, label + ' 撤销生效（画布/统计回退）', undoEnabled && (sigUndo.len !== sigStamp.len || totalAfterUndo < totalBeforeUndo), 'undoEnabled=' + undoEnabled + ' dataUrlLen ' + sigStamp.len + ' -> ' + sigUndo.len + ' stats ' + totalBeforeUndo + ' -> ' + totalAfterUndo);

  const clearBtn = page.getByRole('button', { name: BTN.clear, exact: true }).first();
  if (await clearBtn.isEnabled()) await clearBtn.click();
  await sleep(SETTLE);
  const sigClear = await canvasSignature(page);
  const sessionClear = await readSession(page);
  const clearStats = sessionClear && sessionClear.ink ? sessionClear.ink : null;
  addCheck(state, 'e2e.ink.clear.' + label, label + ' 重来清空画布', sigClear.len === sigEmpty.len || Boolean(clearStats && clearStats.strokes === 0 && clearStats.stamps === 0), 'dataUrlLen=' + sigClear.len + ' empty=' + sigEmpty.len + ' stats=' + JSON.stringify(clearStats));

  await clickButton(page, BTN.brush);
  await drawStroke(page, [0.3, 0.45], [0.68, 0.52]);
  const sessionFinal = await readSession(page);
  addCheck(state, 'e2e.ink.redraw.' + label, label + ' 重画后画布有墨（供收卷）', Boolean(sessionFinal && sessionFinal.ink && sessionFinal.ink.strokes >= 1), JSON.stringify(sessionFinal && sessionFinal.ink));
  await shot(state, page, label + '-05-ink');
}

async function checkReveal(state, page, label) {
  let preview = { ok: false };
  try {
    await page.waitForFunction(() => {
      const img = document.querySelector('.scroll-preview');
      return Boolean(img && img.complete && img.naturalWidth > 0);
    }, null, { timeout: 25000 });
    preview = await page.evaluate(() => {
      const img = document.querySelector('.scroll-preview');
      return { ok: true, width: img.naturalWidth, height: img.naturalHeight, srcHead: img.src.slice(0, 24), srcLen: img.src.length };
    });
  } catch (err) {
    preview = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  addCheck(state, 'e2e.reveal.export.' + label, label + ' 收卷合成画卷（dataURL 非空）', preview.ok && preview.srcLen > 1000 && /^data:image\//.test(preview.srcHead), JSON.stringify(preview).slice(0, 320));
  const dotPairs = await page.locator('.dots .dot-pair').count();
  addCheck(state, 'e2e.reveal.dots.' + label, label + ' 三墨点前后展示', dotPairs === 3, 'dotPairs=' + dotPairs);
  const backCount = await page.locator('.screen-back').count();
  const session = await readSession(page);
  addCheck(state, 'e2e.reveal.lock.' + label, label + ' reveal 后锁定（无返回、step=reveal）', backCount === 0 && Boolean(session && session.step === 'reveal'), 'backButtons=' + backCount + ' step=' + (session && session.step));
}

async function clickSave(state, page, label, mode) {
  if (mode === 'server') {
    const postPromise = page.waitForResponse((r) => r.url().includes('/api/scrolls') && r.request().method() === 'POST', { timeout: 25000 }).catch(() => null);
    await clickButton(page, BTN.save);
    const resp = await postPromise;
    addCheck(state, 'e2e.save.server.post.' + label, label + ' POST /api/scrolls 返回 201', Boolean(resp) && resp.status() === 201, resp ? 'status=' + resp.status() : '无 POST 响应');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /已存进馆藏/.test(b.textContent || '')), null, { timeout: 20000 }).catch(() => {});
    const btnText = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => t.includes('已存')).join('|'));
    addCheck(state, 'e2e.save.server.saved.' + label, label + ' 服务端保存提示=已存进馆藏', btnText.includes('已存进馆藏'), 'buttons=' + btnText);
    const list = await fetchJsonSafe(SERVER_BASE + '/api/scrolls?limit=24');
    const items = list && Array.isArray(list.items) ? list.items : [];
    addCheck(state, 'api.scrolls.savedVisible', '保存后 /api/scrolls 可查到画卷', items.length >= 1, 'items=' + items.length + ' total=' + (list && list.total));
    if (items.length) {
      const imageUrl = new URL(items[0].imageUrl, SERVER_BASE).href;
      const img = await fetchWithStatus(imageUrl);
      addCheck(state, 'api.scrolls.image', '画卷图 URL 可访问且响应类型与前端一致（webp/png）', img.ok && /image\/(webp|png)/.test(img.contentType), 'status=' + img.status + ' type=' + img.contentType + ' url=' + items[0].imageUrl);
    }
  } else {
    await clickButton(page, BTN.save);
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /已存本机馆藏/.test(b.textContent || '')), null, { timeout: 20000 }).catch(() => {});
    const btnText = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => t.includes('已存')).join('|'));
    addCheck(state, 'e2e.save.local.saved.' + label, label + ' 本机保存提示=已存本机馆藏', btnText.includes('已存本机馆藏'), 'buttons=' + btnText);
    const gallery = await readLocalGallery(page);
    const validImage = Array.isArray(gallery) && gallery.length >= 1 && /^data:image\//.test(String(gallery[0].image || ''));
    addCheck(state, 'e2e.save.local.gallery.' + label, label + ' local 保存写入本机馆藏', validImage, 'count=' + (Array.isArray(gallery) ? gallery.length : -1));
  }
}

async function checkGalleryOverlay(state, page, label, options = {}) {
  await clickButton(page, BTN.gallery);
  await page.waitForSelector('#layers .overlay[role="dialog"]', { timeout: 10000 });
  await page.waitForSelector('.gallery-card', { timeout: 12000 }).catch(() => {});
  const cardCount = await page.locator('.gallery-card').count();
  const tagLocal = await page.locator('.tag--local').count();
  let imageLoaded = false;
  try {
    await page.waitForFunction(() => [...document.querySelectorAll('.gallery-card img')].some((i) => i.complete && i.naturalWidth > 0), null, { timeout: 12000 });
    imageLoaded = true;
  } catch (err) { imageLoaded = false; }
  addCheck(state, 'e2e.gallery.cards.' + label, label + ' 馆藏墙显示画卷卡片', cardCount >= (options.minCards || 1), 'cards=' + cardCount);
  addCheck(state, 'e2e.gallery.imageLoaded.' + label, label + ' 馆藏卡片图已加载', imageLoaded, 'imageLoaded=' + imageLoaded);
  if (options.expectLocalTag) addCheck(state, 'e2e.gallery.localTag.' + label, label + ' 本机馆藏有「本机」标签', tagLocal >= 1, 'tagLocal=' + tagLocal);
  await shot(state, page, label + '-07-gallery');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#layers .overlay'), null, { timeout: 8000 }).catch(() => {});
  const overlayLeft = await page.locator('#layers .overlay').count();
  addCheck(state, 'e2e.gallery.close.' + label, label + ' 馆藏浮层可关闭（Esc）', overlayLeft === 0, 'overlayLeft=' + overlayLeft);
}

async function checkAboutOverlay(state, page, label) {
  await clickButton(page, BTN.about);
  await page.waitForSelector('#layers .overlay[role="dialog"]', { timeout: 10000 });
  const info = await page.evaluate(() => {
    const o = document.querySelector('#layers .overlay');
    return {
      text: o ? o.innerText : '',
      links: o ? Array.from(o.querySelectorAll('a')).map((a) => a.getAttribute('href') || '') : [],
    };
  });
  addCheck(state, 'e2e.about.open.' + label, label + ' 关于浮层可打开', info.text.includes('关于'), 'textLen=' + info.text.length);
  addCheck(state, 'e2e.about.privacy.' + label, label + ' 关于含隐私/免责说明', /不是医疗建议|隐私|身份信息/.test(info.text), 'privacy=' + /不是医疗建议/.test(info.text));
  addCheck(state, 'e2e.about.predecessors.' + label, label + ' 关于含两个前身链接', info.links.some((u) => u.includes('mojian')) && info.links.some((u) => u.includes('ink-mind')), info.links.join(', '));
  await shot(state, page, label + '-08-about');
  const closeBtn = page.locator('#layers .overlay .overlay-close').first();
  await closeBtn.click();
  await page.waitForFunction(() => !document.querySelector('#layers .overlay'), null, { timeout: 8000 }).catch(() => {});
  const overlayLeft = await page.locator('#layers .overlay').count();
  addCheck(state, 'e2e.about.close.' + label, label + ' 关于浮层可关闭', overlayLeft === 0, 'overlayLeft=' + overlayLeft);
}

async function checkResume(state, page, label) {
  await page.reload({ waitUntil: 'load', timeout: 30000 });
  await waitStep(page, 'scene', 25000);
  let toastText = '';
  try {
    toastText = await page.waitForFunction(() => {
      const text = [...document.querySelectorAll('.toast')].map((n) => n.textContent || '').join('|');
      return text || null;
    }, null, { timeout: 8000 }).then((h) => h.jsonValue());
  } catch (err) { toastText = ''; }
  const sessionScene = await readSession(page);
  addCheck(state, 'e2e.resume.dryInk.' + label, label + ' ink 后刷新回 scene 并提示「墨已干」', String(toastText).includes('墨已干'), 'toast=' + JSON.stringify(toastText));
  addCheck(state, 'e2e.resume.reset.' + label, label + ' 刷新后墨迹统计清零且 step=scene', Boolean(sessionScene && sessionScene.step === 'scene' && sessionScene.ink.strokes === 0 && sessionScene.ink.stamps === 0), JSON.stringify(sessionScene && { step: sessionScene.step, ink: sessionScene.ink }));
  await clickButton(page, BTN.back);
  await waitStep(page, 'pre');
  await page.reload({ waitUntil: 'load', timeout: 30000 });
  await waitStep(page, 'pre', 25000);
  const sessionPre = await readSession(page);
  addCheck(state, 'e2e.resume.preStep.' + label, label + ' 刷新恢复到 pre（会话有效）', Boolean(sessionPre && sessionPre.step === 'pre'), 'step=' + (sessionPre && sessionPre.step));
}

async function checkFresh(state, page, label, options = {}) {
  const before = await readSession(page);
  const galleryBeforeCount = (await readLocalGallery(page)).length;
  await page.goto(new URL('/?fresh=1', SERVER_BASE).href, { waitUntil: 'load', timeout: 30000 });
  await waitStep(page, 'enter');
  const after = await readSession(page);
  const galleryAfter = await readLocalGallery(page);
  addCheck(state, 'e2e.fresh.reset.' + label, label + ' ?fresh=1 清空会话回 enter', Boolean(after && after.step === 'enter'), 'before=' + (before && before.step) + ' after=' + (after && after.step));
  if (options.galleryBefore) {
    addCheck(state, 'e2e.fresh.keepsGallery.' + label, label + ' ?fresh=1 保留本机馆藏', galleryAfter.length >= galleryBeforeCount && galleryAfter.length >= 1, 'before=' + galleryBeforeCount + ' after=' + galleryAfter.length);
  }
}

async function overflowProbe(state, page, label, step, widths, originalViewport) {
  for (const width of widths) {
    const height = width >= 700 ? 900 : 844;
    await page.setViewportSize({ width, height });
    await sleep(150);
    const info = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
      step: document.body.dataset.step,
    }));
    if (!state.overflow[width]) state.overflow[width] = [];
    state.overflow[width].push({ label, step, scrollWidth: info.scrollWidth, bodyScrollWidth: info.bodyScrollWidth, innerWidth: info.innerWidth });
  }
  await page.setViewportSize(originalViewport);
  await sleep(150);
}

// ---------- 完整七步旅程 ----------

async function runFullJourney(state, options) {
  const {
    label,
    baseURL,
    viewport,
    ink = 'full',
    save = null,
    overlays = false,
    resume = false,
    fresh = false,
    overflowWidths = [],
    touchNoScroll = false,
  } = options;
  const entry = await openTracked(state, label, baseURL, {
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.width < 600,
    hasTouch: viewport.width < 600,
    deviceScaleFactor: 1,
  });
  const page = entry.page;
  const vp = { width: viewport.width, height: viewport.height };
  let flowOk = true;
  let flowErr = '';
  try {
    const status = await bootApp(entry, baseURL, '/?fresh=1');
    addCheck(state, 'e2e.http.200.' + label, label + ' 首页 HTTP 200', status === 200, 'status=' + status);
    const title = await page.title();
    addCheck(state, 'e2e.title.' + label, label + ' 标题含「墨馆」', /墨馆/.test(title), 'title=' + JSON.stringify(title));
    if (overflowWidths.length) await overflowProbe(state, page, label, 'enter', overflowWidths, vp);
    await shot(state, page, label + '-01-enter');

    await clickButton(page, BTN.enter);
    await waitStep(page, 'pre');
    const preGuard = await page.getByRole('button', { name: BTN.preNext }).first().isDisabled();
    addCheck(state, 'e2e.pre.guard.' + label, label + ' pre 未碰完三滑杆时不可进入下一屏', preGuard === true, 'disabled=' + preGuard);
    for (const key of SCALE_KEYS) await touchScale(page, 'pre', key);
    await page.waitForFunction((name) => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === name);
      return Boolean(b && !b.disabled);
    }, BTN.preNext, { timeout: 8000 });
    const preRanges = await rangeInfo(page);
    addCheck(state, 'e2e.pre.aria.' + label, label + ' pre 三滑杆 aria 完整且范围 1–7', preRanges.length === 3 && preRanges.every((r) => r.ariaLabel && r.ariaValueText && r.min === 1 && r.max === 7), JSON.stringify(preRanges).slice(0, 320));
    if (overflowWidths.length) await overflowProbe(state, page, label, 'pre', overflowWidths, vp);
    await shot(state, page, label + '-02-pre');
    await clickButton(page, BTN.preNext);
    await waitStep(page, 'scene');

    const cardCount = await page.locator('.scene-card').count();
    addCheck(state, 'e2e.scene.cards.' + label, label + ' 择境显示 4 张画卡', cardCount === 4, 'cards=' + cardCount);
    const brokenThumbs = await page.evaluate(() => Array.from(document.querySelectorAll('.scene-card img')).filter((i) => !(i.complete && i.naturalWidth > 0)).length);
    addCheck(state, 'e2e.scene.thumbs.' + label, label + ' 场景缩略图全部加载', brokenThumbs === 0, 'broken=' + brokenThumbs);
    if (overflowWidths.length) await overflowProbe(state, page, label, 'scene', overflowWidths, vp);
    await shot(state, page, label + '-03-scene');
    await page.getByRole('button', { name: /早春/ }).first().click();
    await waitStep(page, 'line');

    await clickButton(page, '看一看');
    await page.waitForSelector('.line-next.is-visible', { timeout: 10000 });
    const lineText = await page.locator('.line-text').innerText();
    addCheck(state, 'e2e.line.reply.' + label, label + ' 回应后第二句出现', lineText.length > 0, 'text=' + JSON.stringify(lineText));
    if (overflowWidths.length) await overflowProbe(state, page, label, 'line', overflowWidths, vp);
    await shot(state, page, label + '-04-line');
    await clickButton(page, BTN.lineNext);
    await waitStep(page, 'ink');

    await page.locator('canvas.ink-canvas').first().waitFor({ state: 'visible', timeout: 12000 });
    if (touchNoScroll) {
      const beforeY = await page.evaluate(() => window.scrollY);
      await touchDragCanvas(entry, page);
      const afterY = await page.evaluate(() => window.scrollY);
      addCheck(state, 'e2e.mobile.touchNoPageScroll.' + label, label + ' 画布 touch 不打断/不滚动页面', beforeY === afterY, 'scrollY ' + beforeY + ' -> ' + afterY);
    }
    if (ink === 'full') await checkInk(state, page, label);
    else if (ink === 'touch') await drawStroke(page);
    if (overflowWidths.length) await overflowProbe(state, page, label, 'ink', overflowWidths, vp);
    await clickButton(page, BTN.finish);
    await waitStep(page, 'post');

    const postGuard = await page.getByRole('button', { name: BTN.scrollNext }).first().isDisabled();
    addCheck(state, 'e2e.post.guard.' + label, label + ' post 未完成时不可收卷', postGuard === true, 'disabled=' + postGuard);
    for (const key of SCALE_KEYS) await touchScale(page, 'post', key);
    await page.getByRole('button', { name: '静', exact: true }).first().click();
    await page.waitForFunction((name) => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === name);
      return Boolean(b && !b.disabled);
    }, BTN.scrollNext, { timeout: 8000 });
    if (overflowWidths.length) await overflowProbe(state, page, label, 'post', overflowWidths, vp);
    await shot(state, page, label + '-05-post');
    await clickButton(page, BTN.scrollNext);
    await waitStep(page, 'reveal', 30000);
    if (overflowWidths.length) await overflowProbe(state, page, label, 'reveal', overflowWidths, vp);
    await shot(state, page, label + '-06-reveal', true);
    await checkReveal(state, page, label);

    if (save) await clickSave(state, page, label, save);
    if (overlays) {
      await checkGalleryOverlay(state, page, label, { minCards: 1, expectLocalTag: save === 'local' });
      await checkAboutOverlay(state, page, label);
    }
    if (resume) await checkResume(state, page, label);
    if (fresh) await checkFresh(state, page, label, { galleryBefore: save === 'local' });
  } catch (err) {
    flowOk = false;
    flowErr = String(err && err.stack ? err.stack.split('\n')[0] : err);
  } finally {
    await closeTracked(entry);
    addCheck(state, 'e2e.flow.' + label, label + ' 完整动线 enter→reveal', flowOk, flowErr);
  }
}
// ---------- 静态阶段 ----------

async function runSpawn(state, label, filename, args, options = {}) {
  const { timeout = 300000, shell = false, command = null } = options;
  const res = spawnSync(command || process.execPath, command ? [] : [filename].concat(args || []), {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    timeout,
    shell,
    maxBuffer: 32 * 1024 * 1024,
  });
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  const logPath = path.join(state.outDir, label + '.log');
  try { await writeFile(logPath, stdout + '\n' + stderr, 'utf8'); } catch { /* ignore */ }
  return { status: res.status, stdout, stderr, log: rel(logPath), output: stdout + '\n' + stderr };
}

async function phaseUnits(state) {
  const npm = spawnSync('npm test', {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    timeout: 300000,
    shell: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  const npmOutput = (npm.stdout || '') + '\n' + (npm.stderr || '');
  await writeFile(path.join(state.outDir, 'units-npm-test.log'), npmOutput, 'utf8');
  const passMatch = /# pass (\d+)/.exec(npmOutput);
  const failMatch = /# fail (\d+)/.exec(npmOutput);
  const passCount = passMatch ? Number(passMatch[1]) : 0;
  const failCount = failMatch ? Number(failMatch[1]) : 0;
  state.metrics.unitTests = { exit: npm.status, pass: passCount, fail: failCount };
  addCheck(state, 'unit.npmTest', 'npm test 全绿（§8 门 1）', npm.status === 0 && failCount === 0 && passCount >= 90, 'exit=' + npm.status + ' pass=' + passCount + ' fail=' + failCount);

  const validate = await runSpawn(state, 'units-validate-content', 'scripts/validate-content.mjs', []);
  addCheck(state, 'unit.validateContent', 'validate-content 0 error（§8 门 2）', validate.status === 0 && /0 error/.test(validate.stdout), 'exit=' + validate.status + ' tail=' + validate.stdout.trim().slice(-120));

  const encoding = await runSpawn(state, 'units-check-encoding', 'scripts/check-encoding.mjs', []);
  addCheck(state, 'unit.checkEncoding', 'check-encoding 通过', encoding.status === 0, 'exit=' + encoding.status + ' tail=' + encoding.stdout.trim().slice(-160));
}

async function phaseDocs(state) {
  const docs = ['README.md', 'docs/SPEC.md', 'docs/API.md', 'docs/REA_MUSEUM.md', 'CREDITS.md'];
  const missing = [];
  const sizes = {};
  for (const relPath of docs) {
    try {
      const info = await stat(path.join(PROJECT_ROOT, relPath));
      sizes[relPath] = info.size;
      if (info.size < 100) missing.push(relPath + '(too small)');
    } catch {
      missing.push(relPath + '(missing)');
    }
  }
  state.metrics.docs = sizes;
  addCheck(state, 'docs.core', '§8 门 9：README/SPEC/API/REA_MUSEUM/CREDITS 齐全非空', missing.length === 0, missing.length ? missing.join(', ') : JSON.stringify(sizes));
  addCheck(state, 'docs.qaReport', '§8 门 9：docs/QA_REPORT.md 由本次验收产出', existsSync(path.join(PROJECT_ROOT, 'docs', 'QA_REPORT.md')), 'QA_REPORT.md 存在=' + existsSync(path.join(PROJECT_ROOT, 'docs', 'QA_REPORT.md')));
}

async function phaseBuildStandalone(state) {
  const res = await runSpawn(state, 'standalone-build', 'scripts/build-standalone.mjs', [], { timeout: 240000 });
  const distPath = path.join(PROJECT_ROOT, 'dist', 'standalone.html');
  let size = 0;
  if (existsSync(distPath)) size = (await stat(distPath)).size;
  const inlineMatch = /内联资源 (\d+) 处/.exec(res.stdout);
  const moduleMatch = /模块 (\d+) 个/.exec(res.stdout);
  const maskMatch = /掩膜 (\d+) 块/.exec(res.stdout);
  state.standalone = {
    path: distPath,
    bytes: size,
    moduleCount: moduleMatch ? Number(moduleMatch[1]) : null,
    inlineCount: inlineMatch ? Number(inlineMatch[1]) : null,
    maskCount: maskMatch ? Number(maskMatch[1]) : null,
    buildExit: res.status,
    buildLog: res.log,
  };
  state.metrics.standalone = { bytes: size, moduleCount: state.standalone.moduleCount, inlineCount: state.standalone.inlineCount, maskCount: state.standalone.maskCount };
  addCheck(state, 'standalone.build', '§8 门 8：build-standalone 构建成功', res.status === 0 && size > 100000, 'exit=' + res.status + ' bytes=' + size + ' modules=' + state.standalone.moduleCount + ' inline=' + state.standalone.inlineCount + ' masks=' + state.standalone.maskCount);
}

async function treeStats(dir) {
  let bytes = 0;
  let files = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let items;
    try { items = await readdir(current, { withFileTypes: true }); } catch { continue; }
    for (const item of items) {
      if (item.name === 'node_modules' || item.name === '.git') continue;
      const full = path.join(current, item.name);
      if (item.isDirectory()) stack.push(full);
      else {
        try { bytes += (await stat(full)).size; files += 1; } catch { /* ignore */ }
      }
    }
  }
  return { bytes, files };
}

async function phaseAssetBudget(state) {
  const assets = await treeStats(path.join(PROJECT_ROOT, 'assets'));
  const bg = await treeStats(path.join(PROJECT_ROOT, 'assets', 'bg'));
  let siteTotal = 0;
  let siteFiles = 0;
  for (const dir of ['assets', 'js', 'css', 'content', 'data']) {
    const stats = await treeStats(path.join(PROJECT_ROOT, dir));
    siteTotal += stats.bytes;
    siteFiles += stats.files;
  }
  for (const name of ['index.html', 'manifest.webmanifest', 'robots.txt']) {
    try { const info = await stat(path.join(PROJECT_ROOT, name)); siteTotal += info.size; siteFiles += 1; } catch { /* ignore */ }
  }
  state.metrics.assets = { assetsBytes: assets.bytes, assetsFiles: assets.files, bgBytes: bg.bytes, siteTotalBytes: siteTotal, siteTotalFiles: siteFiles };

  // 首屏 entry：server 模式下测量到 load 为止的同源响应字节
  const entry = await openTracked(state, 'budget-firstscreen', SERVER_BASE, { viewport: { width: 1440, height: 900 } });
  const page = entry.page;
  let loading = true;
  const sizes = new Map();
  page.on('response', (res) => {
    if (!loading) return;
    const url = res.url();
    if (!url.startsWith(SERVER_BASE)) return;
    res.body().then((buf) => { sizes.set(url, buf.length); }).catch(() => {});
  });
  let firstScreenStatus = null;
  try {
    const response = await page.goto(SERVER_BASE + '/?fresh=1', { waitUntil: 'load', timeout: 30000 });
    firstScreenStatus = response ? response.status() : null;
    loading = false;
    await waitStep(page, 'enter');
    await sleep(1800);
  } finally {
    await closeTracked(entry);
  }
  const resources = [...sizes.entries()].map(([url, bytes]) => ({ url: rel(url.replace(SERVER_BASE, path.sep)), bytes })).sort((a, b) => b.bytes - a.bytes);
  const firstScreenBytes = resources.reduce((acc, item) => acc + item.bytes, 0);
  state.metrics.firstScreen = { bytes: firstScreenBytes, resources, status: firstScreenStatus };
  addCheck(state, 'assets.firstScreen', '§8 门 5：首屏 entry 传输 ≤ 600KB', firstScreenBytes > 0 && firstScreenBytes <= 600 * 1024, 'bytes=' + firstScreenBytes + ' (' + (firstScreenBytes / 1024).toFixed(1) + 'KB), resources=' + resources.length);
  addCheck(state, 'assets.images', '§8 门 5：全站图片总量 ≤ 6MB', assets.bytes <= 6 * 1024 * 1024, 'assets=' + assets.bytes + ' (' + (assets.bytes / 1024 / 1024).toFixed(2) + 'MB), bg=' + bg.bytes + ', files=' + assets.files);
  addCheck(state, 'assets.siteTotal', '§8 门 5：全站运行时资源 ≤ 6MB', siteTotal <= 6 * 1024 * 1024, 'siteTotal=' + siteTotal + ' (' + (siteTotal / 1024 / 1024).toFixed(2) + 'MB), files=' + siteFiles);
}

// ---------- API 冒烟 ----------

async function phaseApiSmoke(state) {
  const health = await fetchJsonSafe(SERVER_BASE + '/api/health');
  addCheck(state, 'api.health', 'GET /api/health ok:true', Boolean(health && health.ok === true), JSON.stringify(health).slice(0, 200));
  const content = await fetchJsonSafe(SERVER_BASE + '/api/content');
  addCheck(state, 'api.content', 'GET /api/content 含 museum.title=墨馆', Boolean(content && content.museum && content.museum.title === '墨馆'), 'title=' + (content && content.museum && content.museum.title));
  const scrolls = await fetchJsonSafe(SERVER_BASE + '/api/scrolls?limit=24');
  addCheck(state, 'api.scrollsList', 'GET /api/scrolls 返回 items 数组', Boolean(scrolls && Array.isArray(scrolls.items)), 'items=' + (scrolls && scrolls.items && scrolls.items.length));
  const stats = await fetchJsonSafe(SERVER_BASE + '/api/stats');
  addCheck(state, 'api.stats', 'GET /api/stats 返回对象', Boolean(stats && typeof stats === 'object'), JSON.stringify(stats).slice(0, 200));
}

// ---------- a11y / 键盘 / reduced-motion ----------

async function phaseA11yButtons(state) {
  const entry = await openTracked(state, 'a11y-buttons', SERVER_BASE, { viewport: { width: 1440, height: 900 } });
  const page = entry.page;
  const stepReports = [];
  try {
    await bootApp(entry, SERVER_BASE, '/?fresh=1');
    const collect = async (step) => {
      const buttons = await visibleButtons(page);
      const ranges = await rangeInfo(page);
      stepReports.push({
        step,
        buttons: buttons.length,
        unnamed: buttons.filter((b) => !b.name).length,
        ranges: ranges.length,
        rangesMissingAria: ranges.filter((r) => !r.ariaLabel).length,
        rangesMissingValueText: ranges.filter((r) => !r.ariaValueText && /^(pre|post)-/.test(r.id)).length,
      });
    };
    await collect('enter');
    await clickButton(page, BTN.enter);
    await waitStep(page, 'pre');
    await collect('pre');
    for (const key of SCALE_KEYS) await touchScale(page, 'pre', key);
    await clickButton(page, BTN.preNext);
    await waitStep(page, 'scene');
    await collect('scene');
    await page.getByRole('button', { name: /早春/ }).first().click();
    await waitStep(page, 'line');
    await collect('line');
    await clickButton(page, '看一看');
    await page.waitForSelector('.line-next.is-visible', { timeout: 10000 });
    await clickButton(page, BTN.lineNext);
    await waitStep(page, 'ink');
    await page.locator('canvas.ink-canvas').first().waitFor({ state: 'visible', timeout: 12000 });
    await collect('ink');
    await clickButton(page, BTN.finish);
    await waitStep(page, 'post');
    await collect('post');
  } catch (err) {
    stepReports.push({ step: 'error', error: String(err && err.message ? err.message : err) });
  } finally {
    await closeTracked(entry);
  }
  const unnamed = stepReports.reduce((acc, item) => acc + (item.unnamed || 0), 0);
  const rangesMissingAria = stepReports.reduce((acc, item) => acc + (item.rangesMissingAria || 0), 0);
  const rangesMissingValueText = stepReports.reduce((acc, item) => acc + (item.rangesMissingValueText || 0), 0);
  const totalRanges = stepReports.reduce((acc, item) => acc + (item.ranges || 0), 0);
  state.metrics.a11ySteps = stepReports;
  addCheck(state, 'a11y.buttonNames', '§8 门 6：可见按钮均有可读名称', unnamed === 0 && stepReports.every((item) => !item.error), 'unnamed=' + unnamed + ', steps=' + stepReports.length + (stepReports.filter((s) => s.error).length ? ', errors=' + JSON.stringify(stepReports.filter((s) => s.error)) : ''));
  addCheck(state, 'a11y.sliderAria', '§8 门 6：滑杆有 aria-label（pre/post 有 aria-valuetext）', rangesMissingAria === 0 && rangesMissingValueText === 0 && totalRanges >= 6, 'ranges=' + totalRanges + ' missingAria=' + rangesMissingAria + ' missingValueText=' + rangesMissingValueText);
}

async function phaseKeyboard(state) {
  const entry = await openTracked(state, 'a11y-keyboard', SERVER_BASE, { viewport: { width: 1440, height: 900 } });
  const page = entry.page;
  let ok = true;
  let err = '';
  try {
    await page.goto(SERVER_BASE + '/?fresh=1', { waitUntil: 'load', timeout: 30000 });
    await waitStep(page, 'enter');
    await tabTo(page, (d) => d.text === BTN.enter || d.aria === BTN.enter);
    await pressEnter(page);
    await waitStep(page, 'pre');
    for (const key of SCALE_KEYS) {
      await tabTo(page, (d) => d.type === 'range' && d.id === 'pre-' + key);
      await page.keyboard.press('ArrowRight');
      await sleep(60);
    }
    await tabTo(page, (d) => d.text === BTN.preNext);
    await pressEnter(page);
    await waitStep(page, 'scene');
    await tabTo(page, (d) => d.aria && d.aria.includes('早春'));
    await pressEnter(page);
    await waitStep(page, 'line');
    await tabTo(page, (d) => d.text === '看一看');
    await pressEnter(page);
    await page.waitForSelector('.line-next.is-visible', { timeout: 10000 });
    await tabTo(page, (d) => d.text === BTN.lineNext);
    await pressEnter(page);
    await waitStep(page, 'ink');
    await tabTo(page, (d) => d.text === BTN.finish);
    await pressEnter(page);
    await waitStep(page, 'post');
    for (const key of SCALE_KEYS) {
      await tabTo(page, (d) => d.type === 'range' && d.id === 'post-' + key);
      await page.keyboard.press('ArrowRight');
      await sleep(60);
    }
    await tabTo(page, (d) => d.text === '静');
    await pressEnter(page);
    await tabTo(page, (d) => d.text === BTN.scrollNext);
    await pressEnter(page);
    await waitStep(page, 'reveal', 25000);
    await shot(state, page, 'a11y-keyboard-reveal');
  } catch (e) {
    ok = false;
    err = String(e && e.message ? e.message : e);
  } finally {
    await closeTracked(entry);
  }
  addCheck(state, 'a11y.keyboardFlow', '§8 门 6：纯键盘完成 enter→reveal（非绘画流程）', ok, err);
}

function parseDurations(text) {
  return String(text || '')
    .split(',')
    .map((s) => s.trim())
    .map((s) => {
      const m = /([\d.]+)(ms|s)/.exec(s);
      if (!m) return 0;
      return m[2] === 'ms' ? parseFloat(m[1]) / 1000 : parseFloat(m[1]);
    })
    .filter((v) => Number.isFinite(v) && v >= 0);
}

async function measureMotion(page) {
  const maxTransition = async () => page.evaluate(() => {
    let max = 0;
    const nodes = document.querySelectorAll('#stage *, #backdrop, #stage, body');
    for (const node of nodes) {
      const styles = getComputedStyle(node);
      const parts = String(styles.transitionDuration || '').split(',');
      for (const part of parts) {
        const m = /([\d.]+)(ms|s)/.exec(part.trim());
        if (!m) continue;
        const value = m[2] === 'ms' ? parseFloat(m[1]) / 1000 : parseFloat(m[1]);
        if (value > max) max = value;
      }
      const animParts = String(styles.animationDuration || '').split(',');
      for (const part of animParts) {
        const m = /([\d.]+)(ms|s)/.exec(part.trim());
        if (!m) continue;
        const value = m[2] === 'ms' ? parseFloat(m[1]) / 1000 : parseFloat(m[1]);
        if (value > max) max = value;
      }
    }
    return max;
  });
  const before = await maxTransition();
  const t0 = Date.now();
  await clickButton(page, BTN.enter);
  await waitStep(page, 'pre', 15000);
  const elapsedMs = Date.now() - t0;
  await sleep(150);
  const after = await maxTransition();
  return { elapsedMs, maxTransitionSec: Math.max(before, after), before, after };
}

async function phaseReducedMotion(state) {
  let normal = null;
  let reduced = null;
  const normalEntry = await openTracked(state, 'motion-normal', SERVER_BASE, { viewport: { width: 1440, height: 900 } });
  try {
    await normalEntry.page.goto(SERVER_BASE + '/?fresh=1', { waitUntil: 'load', timeout: 30000 });
    await waitStep(normalEntry.page, 'enter');
    normal = await measureMotion(normalEntry.page);
  } catch (err) {
    normal = { error: String(err && err.message ? err.message : err) };
  } finally {
    await closeTracked(normalEntry);
  }
  const reducedEntry = await openTracked(state, 'motion-reduced', SERVER_BASE, { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  try {
    await reducedEntry.page.goto(SERVER_BASE + '/?fresh=1', { waitUntil: 'load', timeout: 30000 });
    await waitStep(reducedEntry.page, 'enter');
    reduced = await measureMotion(reducedEntry.page);
  } catch (err) {
    reduced = { error: String(err && err.message ? err.message : err) };
  } finally {
    await closeTracked(reducedEntry);
  }
  state.metrics.motion = { normal, reduced };
  addCheck(state, 'a11y.normalMotion', '普通模式切步有水墨动效（0.9–1.4s，SPEC §2）', Boolean(normal && normal.maxTransitionSec >= 0.85 && normal.maxTransitionSec <= 1.5), JSON.stringify(normal));
  addCheck(state, 'a11y.reducedMotion', '§8 门 6：reduced-motion 直切无长动效（transition≈0s 且切换 <300ms）', Boolean(reduced && reduced.maxTransitionSec <= 0.05 && reduced.elapsedMs <= 300), JSON.stringify(reduced));
}

// ---------- standalone file:// ----------

async function phaseStandaloneFile(state) {
  if (!state.standalone || !state.standalone.path || !existsSync(state.standalone.path)) {
    addCheck(state, 'standalone.file', '§8 门 8：standalone file:// 运行（构建缺失，未测）', false, 'dist/standalone.html 不存在');
    return;
  }
  const fileUrl = 'file:///' + state.standalone.path.replace(/\\/g, '/');
  const entry = await openTracked(state, 'standalone-file', SERVER_BASE, { viewport: { width: 1440, height: 900 } });
  const page = entry.page;
  let ok = true;
  let err = '';
  try {
    const response = await page.goto(fileUrl, { waitUntil: 'load', timeout: 30000 });
    await waitStep(page, 'enter', 20000);
    const title = await page.title();
    await shot(state, page, 'standalone-enter');
    const fileResources = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /^file:/.test(e.name)).map((e) => e.name));
    addCheck(state, 'standalone.inlined', 'file:// 打开无未内联的 file:// 资源引用', fileResources.length === 0, 'fileResources=' + fileResources.length + (fileResources.length ? ': ' + fileResources.slice(0, 3).join(', ') : ''));
    addCheck(state, 'standalone.title', 'standalone 标题含「墨馆」', /墨馆/.test(title), 'title=' + JSON.stringify(title));

    await clickButton(page, BTN.enter);
    await waitStep(page, 'pre');
    for (const key of SCALE_KEYS) await touchScale(page, 'pre', key);
    await clickButton(page, BTN.preNext);
    await waitStep(page, 'scene');
    await page.getByRole('button', { name: /早春/ }).first().click();
    await waitStep(page, 'line');
    await clickButton(page, '看一看');
    await page.waitForSelector('.line-next.is-visible', { timeout: 10000 });
    await clickButton(page, BTN.lineNext);
    await waitStep(page, 'ink');
    await page.locator('canvas.ink-canvas').first().waitFor({ state: 'visible', timeout: 12000 });
    await drawStroke(page);
    const sig = await canvasSignature(page);
    addCheck(state, 'standalone.ink', 'standalone 能落墨（画布非空）', sig.ok && sig.len > 500, 'dataUrlLen=' + sig.len);
    await shot(state, page, 'standalone-ink');
    await clickButton(page, BTN.finish);
    await waitStep(page, 'post');
    for (const key of SCALE_KEYS) await touchScale(page, 'post', key);
    await page.getByRole('button', { name: '静', exact: true }).first().click();
    await page.waitForFunction((name) => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === name);
      return Boolean(b && !b.disabled);
    }, BTN.scrollNext, { timeout: 8000 });
    await clickButton(page, BTN.scrollNext);
    await waitStep(page, 'reveal', 30000);
    let previewOk = false;
    try {
      await page.waitForFunction(() => {
        const img = document.querySelector('.scroll-preview');
        return Boolean(img && img.complete && img.naturalWidth > 0);
      }, null, { timeout: 20000 });
      previewOk = true;
    } catch { previewOk = false; }
    addCheck(state, 'standalone.reveal', 'standalone 收卷预览合成成功', previewOk, 'previewOk=' + previewOk);
    await shot(state, page, 'standalone-reveal', true);
    const external = entry.collector.externalRequests;
    addCheck(state, 'standalone.zeroExternal', 'standalone file:// 零外站请求', external.length === 0, external.map((e) => e.url).join(', ').slice(0, 300));
    const consoleErrors = entry.collector.consoleErrors;
    addCheck(state, 'standalone.consoleNoErrors', '§8 门 8：standalone 控制台 0 error', consoleErrors.length === 0, consoleErrors.map((e) => e.text).join(' | ').slice(0, 300));
  } catch (e) {
    ok = false;
    err = String(e && e.message ? e.message : e);
  } finally {
    await closeTracked(entry);
  }
  addCheck(state, 'standalone.flow', '§8 门 8：standalone file:// 走完 enter→reveal', ok, err);
}

// ---------- 汇总 / 入口 ----------

function finalizeOverflow(state) {
  for (const width of [320, 375, 430, 1440]) {
    const rows = state.overflow[width] || [];
    if (!rows.length) continue;
    const bad = rows.filter((r) => r.scrollWidth > r.innerWidth + 1 || r.bodyScrollWidth > r.innerWidth + 1);
    addCheck(state, 'mobile.noHScroll.' + width, '§8 门 7：视口 ' + width + 'px 各步骤无横向溢出', bad.length === 0, bad.length ? JSON.stringify(bad.slice(0, 4)) : rows.length + ' 个步骤采样无溢出');
  }
}

async function phaseCleanup(state) {
  if (state.browser) {
    try { await state.browser.close(); } catch { /* ignore */ }
    state.browser = null;
  }
  if (state.server) {
    try { await state.server.stop(); } catch { /* ignore */ }
  }
  if (state.staticServer) {
    try { await state.staticServer.stop(); } catch { /* ignore */ }
  }
  if (state.tempDataDir) {
    try { await rm(state.tempDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
    state.metrics.tempDataDir = { path: state.tempDataDir, removed: !existsSync(state.tempDataDir) };
  }
}

export async function runFullSuite({ result, outDir, args = {} }) {
  const state = {
    result,
    outDir,
    args,
    checks: [],
    pages: [],
    screenshots: [],
    metrics: {},
    overflow: {},
    browser: null,
    server: null,
    staticServer: null,
    tempDataDir: path.join(process.env.TEMP || os.tmpdir(), 'im-qa-final'),
    standalone: null,
    startedAt: nowIso(),
  };
  result.checks = state.checks;
  result.target = { mode: 'server+local+standalone', serverBase: SERVER_BASE, staticBase: STATIC_BASE };
  result.server = { mode: 'spawned-clean', baseURL: SERVER_BASE, startedByUs: true, pid: null, warnings: [] };
  try {
    await mkdir(state.tempDataDir, { recursive: true });
    await rm(state.tempDataDir, { recursive: true, force: true });
    await mkdir(state.tempDataDir, { recursive: true });

    state.server = await spawnQaServer({
      baseURL: SERVER_BASE,
      entryRel: 'server/index.mjs',
      env: {
        DATA_DIR: state.tempDataDir,
        SAVE_LIMIT_MAX: '200',
        SAVE_LIMIT_WINDOW_MS: '600000',
        READ_LIMIT_MAX: '100000',
        READ_LIMIT_WINDOW_MS: '600000',
      },
      serverLogPath: path.join(outDir, 'server-mode.log'),
    });
    result.server.pid = state.server.pid;
    result.server.serverLog = state.server.serverLogRel;
    addCheck(state, 'infra.server', '干净 server 模式服务已启动（临时 DATA_DIR + 放宽限流）', state.server.pid > 0, 'pid=' + state.server.pid + ' base=' + SERVER_BASE);
    state.staticServer = await spawnQaServer({
      baseURL: STATIC_BASE,
      entryRel: 'scripts/serve-static.mjs',
      serverLogPath: path.join(outDir, 'local-static.log'),
    });
    addCheck(state, 'infra.staticServer', 'local 静态服务已启动（serve-static）', state.staticServer.pid > 0, 'pid=' + state.staticServer.pid + ' base=' + STATIC_BASE);

    const browserHandle = await launchBrowser({ headless: true });
    state.browser = browserHandle.browser;
    result.env.playwright = browserHandle.playwrightVersion;
    result.env.chromePath = browserHandle.executablePath;
    result.env.chromeVersion = browserHandle.version;

    await phaseUnits(state);
    await phaseDocs(state);
    await phaseBuildStandalone(state);
    await phaseApiSmoke(state);
    await phaseAssetBudget(state);

    await runFullJourney(state, { label: 'server-desktop', baseURL: SERVER_BASE, viewport: { width: 1440, height: 900 }, ink: 'full', save: 'server', overlays: true, resume: true, fresh: true, overflowWidths: [1440] });
    await runFullJourney(state, { label: 'server-mobile390', baseURL: SERVER_BASE, viewport: { width: 390, height: 844 }, ink: 'touch', overflowWidths: [320, 375, 430], touchNoScroll: true });
    await runFullJourney(state, { label: 'server-narrow320', baseURL: SERVER_BASE, viewport: { width: 320, height: 640 }, ink: 'touch', overflowWidths: [320], touchNoScroll: true });
    await runFullJourney(state, { label: 'local-desktop', baseURL: STATIC_BASE, viewport: { width: 1440, height: 900 }, ink: 'full', save: 'local', overlays: true, resume: true, fresh: true, overflowWidths: [] });

    await phaseA11yButtons(state);
    await phaseKeyboard(state);
    await phaseReducedMotion(state);
    await phaseStandaloneFile(state);
  } catch (err) {
    if (err instanceof InfraError) {
      addCheck(state, 'suite.infra', 'full suite 基建可用', false, String(err && err.message ? err.message : err));
    } else {
      addCheck(state, 'suite.internal', 'full suite 内部异常', false, String(err && (err.stack || err.message) || err).slice(0, 1200));
    }
  } finally {
    await phaseCleanup(state);
    finalizeOverflow(state);
    finalizeResult(state);
    state.metrics.durationMs = Date.now() - Date.parse(state.startedAt);
    state.metrics.finishedAt = nowIso();
  }
}