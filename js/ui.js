// ui.js — DOM 小工具、动效时长、toast、浮层管理与焦点、aria-live、键盘 Esc。
// 只做通用 UI 基建；具体文案一律由 content.js 注入。

export function qs(selector, root) {
  const host = root || (typeof document !== 'undefined' ? document : null);
  return host ? host.querySelector(selector) : null;
}

export function qsa(selector, root) {
  const host = root || (typeof document !== 'undefined' ? document : null);
  if (!host) return [];
  return Array.prototype.slice.call(host.querySelectorAll(selector));
}

export function el(tag, props, children) {
  const node = document.createElement(tag);
  const options = props || {};
  const keys = Object.keys(options);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const value = options[key];
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') {
      const names = Object.keys(value);
      for (let j = 0; j < names.length; j += 1) node.dataset[names[j]] = value[names[j]];
    } else if (key === 'style' && typeof value === 'object') {
      const names = Object.keys(value);
      for (let j = 0; j < names.length; j += 1) node.style.setProperty(names[j], value[names[j]]);
    } else if (key.slice(0, 2) === 'on' && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  if (children) {
    const list = Array.isArray(children) ? children : [children];
    for (let i = 0; i < list.length; i += 1) {
      const child = list[i];
      if (child === null || child === undefined || child === false) continue;
      if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
  }
  return node;
}

export function clearNode(node) {
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function button(text, options) {
  const opts = options || {};
  const node = el(
    'button',
    {
      class: opts.class || 'btn',
      type: 'button',
      'aria-label': opts.ariaLabel || opts['aria-label'] || null,
      'aria-pressed': opts.pressed === undefined ? null : opts.pressed ? 'true' : 'false',
      disabled: opts.disabled ? true : null
    },
    [text]
  );
  if (opts.dataset) {
    const names = Object.keys(opts.dataset);
    for (let i = 0; i < names.length; i += 1) node.dataset[names[i]] = opts.dataset[names[i]];
  }
  if (opts.on) {
    const events = Object.keys(opts.on);
    for (let i = 0; i < events.length; i += 1) {
      node.addEventListener(events[i].toLowerCase(), opts.on[events[i]]);
    }
  }
  return node;
}

export function reducedMotion() {
  try {
    return Boolean(
      typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch (err) {
    return false;
  }
}

export function motionMs(defaultMs) {
  const value = typeof defaultMs === 'number' ? defaultMs : 1200;
  return reducedMotion() ? 0 : value;
}

export function waitFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export function wait(ms) {
  const delay = typeof ms === 'number' && ms > 0 ? ms : 0;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

export function focusNode(node) {
  if (!node || typeof node.focus !== 'function') return;
  try {
    node.focus({ preventScroll: true });
  } catch (err) {
    try {
      node.focus();
    } catch (err2) {
      /* ignore */
    }
  }
}

export function setBodyStep(step) {
  if (typeof document === 'undefined') return;
  document.body.dataset.step = step;
}

export function announce(text) {
  if (typeof document === 'undefined' || !text) return;
  const live = qs('#live');
  if (!live) return;
  live.textContent = '';
  window.setTimeout(() => {
    live.textContent = text;
  }, 40);
}

// ---------- toast ----------

let toastSeq = 0;

export function toast(text, options) {
  if (typeof document === 'undefined' || !text) return;
  const host = qs('#toasts');
  if (!host) return;
  const opts = options || {};
  const item = el('p', { class: 'toast', text: String(text), role: 'status' });
  host.appendChild(item);
  toastSeq += 1;
  const mySeq = toastSeq;
  const liveMs = typeof opts.duration === 'number' ? opts.duration : 2600;
  const remove = () => {
    if (!item.parentNode) return;
    item.classList.add('is-out');
    window.setTimeout(() => {
      if (item.parentNode) item.parentNode.removeChild(item);
    }, reducedMotion() ? 0 : 380);
  };
  window.setTimeout(() => {
    if (mySeq === toastSeq || !opts.keep) remove();
  }, liveMs);
  while (host.children.length > 2) host.removeChild(host.firstChild);
}

// ---------- 浮层管理（gallery / about / lightbox 共用） ----------

const overlayStack = [];
let overlayKeyBound = false;
let overlayReturnFocus = null;

function overlayTop() {
  return overlayStack.length ? overlayStack[overlayStack.length - 1] : null;
}

function setBackgroundInert(inert) {
  const ids = ['#stage', '#chrome'];
  for (let i = 0; i < ids.length; i += 1) {
    const node = qs(ids[i]);
    if (!node) continue;
    if (inert) {
      node.setAttribute('inert', '');
      node.setAttribute('aria-hidden', 'true');
    } else {
      node.removeAttribute('inert');
      node.removeAttribute('aria-hidden');
    }
  }
}

function focusablesIn(root) {
  return qsa(
    'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"]), audio[controls], video[controls]',
    root
  ).filter((node) => node.offsetParent !== null || node === document.activeElement);
}

function trapTab(event) {
  const top = overlayTop();
  if (!top) return;
  const nodes = focusablesIn(top.el);
  if (nodes.length === 0) {
    event.preventDefault();
    focusNode(top.el);
    return;
  }
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === top.el)) {
    event.preventDefault();
    focusNode(last);
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    focusNode(first);
  }
}

function onOverlayKeydown(event) {
  if (!overlayStack.length) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    const top = overlayTop();
    if (top) closeOverlay(top.el);
    return;
  }
  if (event.key === 'Tab') trapTab(event);
}

function ensureOverlayKeys() {
  if (overlayKeyBound || typeof document === 'undefined') return;
  document.addEventListener('keydown', onOverlayKeydown, true);
  overlayKeyBound = true;
}

export function hasOverlay() {
  return overlayStack.length > 0;
}

export function openOverlay(build, options) {
  const opts = options || {};
  ensureOverlayKeys();
  const node = typeof build === 'function' ? build() : build;
  if (!node) return null;
  const wrapper = node.classList && node.classList.contains('overlay')
    ? node
    : el('div', { class: 'overlay' }, [node]);
  wrapper.setAttribute('role', 'dialog');
  wrapper.setAttribute('aria-modal', 'true');
  if (opts.label) wrapper.setAttribute('aria-label', opts.label);
  if (!wrapper.getAttribute('tabindex')) wrapper.setAttribute('tabindex', '-1');

  const host = qs('#layers') || document.body;
  const previousFocus = document.activeElement;
  host.appendChild(wrapper);
  overlayStack.push({ el: wrapper, onClose: opts.onClose || null, returnFocus: previousFocus });
  setBackgroundInert(true);

  requestAnimationFrame(() => {
    wrapper.classList.add('is-ready');
  });
  window.setTimeout(() => {
    const target = opts.initialFocus ? wrapper.querySelector(opts.initialFocus) : null;
    focusNode(target || wrapper);
  }, 30);
  return wrapper;
}

export function closeOverlay(node) {
  const index = overlayStack.findIndex((entry) => entry.el === (node || overlayTop()?.el));
  if (index < 0) return;
  const entry = overlayStack[index];
  overlayStack.splice(index, 1);
  const finish = () => {
    if (entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
    if (!overlayStack.length) {
      setBackgroundInert(false);
      const target = entry.returnFocus;
      if (target && target.isConnected) focusNode(target);
    }
    if (typeof entry.onClose === 'function') {
      try {
        entry.onClose();
      } catch (err) {
        /* ignore */
      }
    }
  };
  entry.el.classList.add('is-closing');
  entry.el.classList.remove('is-ready');
  window.setTimeout(finish, reducedMotion() ? 0 : 460);
}

export function closeTopOverlay() {
  const top = overlayTop();
  if (top) closeOverlay(top.el);
}

export function closeAllOverlays() {
  while (overlayStack.length) {
    const entry = overlayStack.pop();
    if (entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
    if (typeof entry.onClose === 'function') {
      try {
        entry.onClose();
      } catch (err) {
        /* ignore */
      }
    }
  }
  setBackgroundInert(false);
  overlayReturnFocus = null;
}

// 供 journey 在页面切换时清掉焦点残留
export function blurActive() {
  if (typeof document === 'undefined') return;
  const active = document.activeElement;
  if (active && active !== document.body && typeof active.blur === 'function') active.blur();
}