// scenes.js — 展厅背景的 art-direction：<picture> 按宽高比切 wide/tall，
// 预加载当前与下一屏，切换用交叉淡入；图片缺失时退回 CSS 墨色渐变（不报错）。

import { qs } from './ui.js';

const TALL_MEDIA = '(max-aspect-ratio: 4/5)';

function makeLayer() {
  const layer = document.createElement('div');
  layer.className = 'backdrop-layer';
  const picture = document.createElement('picture');
  const source = document.createElement('source');
  source.media = TALL_MEDIA;
  const img = document.createElement('img');
  img.alt = '';
  img.decoding = 'async';
  img.setAttribute('aria-hidden', 'true');
  picture.appendChild(source);
  picture.appendChild(img);
  layer.appendChild(picture);
  return { layer, source, img };
}

export function prefersTall() {
  try {
    return Boolean(window.matchMedia && window.matchMedia(TALL_MEDIA).matches);
  } catch (err) {
    return false;
  }
}

export function preloadBackground(bg) {
  return new Promise((resolve) => {
    if (!bg || typeof bg.wide !== 'string') {
      resolve(false);
      return;
    }
    if (typeof Image !== 'function') {
      resolve(false);
      return;
    }
    const src = prefersTall() && bg.tall ? bg.tall : bg.wide;
    const probe = new Image();
    probe.decoding = 'async';
    probe.onload = () => resolve(true);
    probe.onerror = () => resolve(false);
    probe.src = src;
  });
}

export function createBackdrop(host) {
  const root = host || qs('#backdrop');
  const layerA = makeLayer();
  const layerB = makeLayer();
  if (root) {
    root.appendChild(layerA.layer);
    root.appendChild(layerB.layer);
  }
  let front = null;
  let currentKey = null;
  let currentBg = null;
  let currentPosition = '';
  let destroyed = false;

  function applyImage(entry, bg, position) {
    entry.layer.style.setProperty('--bg-pos', position || '50% 50%');
    entry.layer.classList.remove('is-loaded');
    entry.layer.classList.remove('is-missing');
    entry.img.onload = null;
    entry.img.onerror = null;
    entry.img.onload = () => {
      if (destroyed) return;
      entry.layer.classList.add('is-loaded');
    };
    entry.img.onerror = () => {
      if (destroyed) return;
      entry.layer.classList.add('is-missing');
    };
    entry.source.srcset = bg.tall || '';
    entry.img.src = bg.wide || (bg.tall || '');
    if (entry.img.complete && entry.img.naturalWidth > 0) {
      entry.layer.classList.add('is-loaded');
    }
  }

  function setSource(bg, options) {
    if (destroyed) return;
    const opts = options || {};
    const position = (bg && bg.position) || (opts.position || '50% 50%');
    const key = bg ? String(bg.wide || '') + '|' + String(bg.tall || '') : null;
    if (key === currentKey) {
      if (root && position !== currentPosition) {
        currentPosition = position;
        if (front) front.layer.style.setProperty('--bg-pos', position);
      }
      return;
    }
    currentKey = key;
    currentBg = bg || null;
    currentPosition = position;

    if (!bg) {
      if (front) {
        front.layer.classList.remove('is-front');
        front = null;
      }
      return;
    }

    let target = front === layerA ? layerB : layerA;
    if (!front) {
      // 首次：两个都清空，用 A
      layerA.layer.classList.remove('is-front', 'is-loaded', 'is-missing');
      layerB.layer.classList.remove('is-front', 'is-loaded', 'is-missing');
      target = layerA;
    }
    if (opts.immediate) {
      target.layer.style.transition = 'none';
      target.layer.classList.remove('is-front');
    }
    applyImage(target, bg, position);
    target.layer.classList.add('is-front');
    const previous = front;
    front = target;
    if (opts.immediate) {
      requestAnimationFrame(() => {
        target.layer.style.transition = '';
      });
    }
    if (previous && previous !== target) previous.layer.classList.remove('is-front');
  }

  function getFrontImage() {
    if (!front || !front.img) return null;
    const img = front.img;
    if (img.complete && img.naturalWidth > 0) return img;
    return null;
  }

  function getFrontPosition() {
    return currentPosition || '50% 50%';
  }

  function destroy() {
    destroyed = true;
    if (root) {
      if (layerA.layer.parentNode === root) root.removeChild(layerA.layer);
      if (layerB.layer.parentNode === root) root.removeChild(layerB.layer);
    }
  }

  return { setSource, getFrontImage, getFrontPosition, destroy };
}