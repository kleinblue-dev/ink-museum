// api.js — 后端探测与降级：启动 GET api/health（800ms 超时）判定 server/local；
// local 模式是完整可玩的默认路径（GitHub Pages / 双击打开都能走完动线）。
// 本机馆藏写 localStorage（最多 6 条，超了丢最旧）；保存失败静默降级。

import { CONTENT } from '../content/content.js';
import { loadLocalGallery, saveLocalGallery } from './state.js';

export const api = { mode: 'local', health: null, checked: false };

const HEALTH_TIMEOUT_MS = 800;
const LOCAL_MAX = 6;

let apiModePromise = null;

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function fetchJson(url, options, timeoutMs) {
  const opts = options || {};
  let controller = null;
  if (typeof AbortController === 'function') {
    controller = new AbortController();
    opts.signal = controller.signal;
  }
  const task = (async () => {
    const response = await fetch(url, opts);
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (err) {
      data = null;
    }
    return { response, data };
  })();
  try {
    return await withTimeout(task, timeoutMs || HEALTH_TIMEOUT_MS);
  } finally {
    if (controller) controller.abort();
  }
}

// 强制/短路：file://、*.github.io 一律 local（避免 404 红错污染控制台）；
// ?api=server|local 供 QA 强制指定。
export function resolveForcedMode() {
  try {
    const search = new URLSearchParams(window.location.search);
    const forced = search.get('api');
    if (forced === 'local' || forced === 'server') return forced;
  } catch (err) {
    /* ignore */
  }
  try {
    if (window.location.protocol === 'file:') return 'local';
    if (/\.github\.io$/i.test(window.location.hostname)) return 'local';
  } catch (err) {
    /* ignore */
  }
  return null;
}

export function detectApiMode() {
  const forced = resolveForcedMode();
  if (forced) {
    api.mode = forced;
    api.checked = true;
    return Promise.resolve(api.mode);
  }
  if (typeof fetch !== 'function') {
    api.mode = 'local';
    api.checked = true;
    return Promise.resolve(api.mode);
  }
  const task = (async () => {
    try {
      const result = await fetchJson(
        'api/health',
        { headers: { Accept: 'application/json' }, cache: 'no-store' },
        HEALTH_TIMEOUT_MS
      );
      if (result.response && result.response.ok && result.data && result.data.ok === true) {
        api.mode = 'server';
        api.health = result.data;
      } else {
        api.mode = 'local';
      }
    } catch (err) {
      api.mode = 'local';
    }
    api.checked = true;
    return api.mode;
  })();
  return task;
}

export function ensureApiMode() {
  if (!apiModePromise) apiModePromise = detectApiMode();
  return apiModePromise;
}

export function currentApiMode() {
  return api.mode;
}

// 服务端 content（一般与本地 content.js 一致）；失败静默回退本地模块。
export async function getContent() {
  if (api.mode !== 'server') return CONTENT;
  try {
    const result = await fetchJson('api/content', { headers: { Accept: 'application/json' }, cache: 'no-store' }, 900);
    if (result.response && result.response.ok && result.data && result.data.museum) return result.data;
  } catch (err) {
    /* fallthrough */
  }
  return CONTENT;
}

export function makeIdempotencyKey() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch (err) {
    /* ignore */
  }
  let seed = '';
  try {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length; i += 1) seed += bytes[i].toString(16).padStart(2, '0');
  } catch (err) {
    seed = String(Date.now()) + String(Math.random()).slice(2);
  }
  return seed;
}

export function makeLocalId() {
  return 'local_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// ---------- 保存画卷 ----------

export async function saveScroll(payload, idempotencyKey) {
  await ensureApiMode();
  if (api.mode !== 'server') throw new Error('local-mode');
  const result = await fetchJson(
    'api/scrolls',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': idempotencyKey || makeIdempotencyKey()
      },
      body: JSON.stringify(payload)
    },
    8000
  );
  if (!result.response || !result.response.ok) {
    throw new Error('save-failed-' + (result.response ? result.response.status : 'network'));
  }
  return result.data;
}

export async function listScrolls(limit) {
  await ensureApiMode();
  if (api.mode !== 'server') return { items: [], error: false };
  const size = Math.max(1, Math.min(60, Math.round(Number(limit) || 24)));
  try {
    const result = await fetchJson('api/scrolls?limit=' + size, { headers: { Accept: 'application/json' }, cache: 'no-store' }, 3500);
    if (result.response && result.response.ok && result.data) {
      return { items: Array.isArray(result.data.items) ? result.data.items : [], error: false };
    }
    return { items: [], error: true };
  } catch (err) {
    return { items: [], error: true };
  }
}

// ---------- 本机馆藏（local 模式） ----------

function sortByTimeDesc(items) {
  return items.slice().sort((a, b) => {
    const ta = Date.parse(a && a.createdAt) || 0;
    const tb = Date.parse(b && b.createdAt) || 0;
    return tb - ta;
  });
}

export function listLocalScrolls(storage) {
  const items = loadLocalGallery(storage);
  const valid = items.filter(
    (item) => item && typeof item === 'object' && typeof item.image === 'string' && item.image.slice(0, 5) === 'data:'
  );
  return sortByTimeDesc(valid);
}

// 返回 { ok, items }；配额不足时逐条丢最旧再试。
export function saveLocalScroll(item, storage) {
  const existing = listLocalScrolls(storage).filter((entry) => entry.id !== item.id);
  let items = [item].concat(existing).slice(0, LOCAL_MAX);
  while (items.length > 0) {
    if (saveLocalGallery(storage, items)) return { ok: true, items };
    items = items.slice(0, items.length - 1);
  }
  return { ok: false, items: [] };
}

export const INK_VALUE_MAX = 600000;

export function clampInkValue(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(INK_VALUE_MAX, n);
}

export function buildPayload(session, image, mood) {
  return {
    schemaVersion: session.schemaVersion,
    clientId: session.clientId,
    sceneId: session.sceneId,
    pre: { tight: session.pre.tight, tired: session.pre.tired, scattered: session.pre.scattered },
    post: {
      tight: session.post.tight,
      tired: session.post.tired,
      scattered: session.post.scattered,
      mood: mood || session.post.mood
    },
    ink: {
      strokes: clampInkValue(session.ink.strokes),
      stamps: clampInkValue(session.ink.stamps),
      ms: clampInkValue(session.ink.ms)
    },
    image,
    mood: mood || session.post.mood
  };
}