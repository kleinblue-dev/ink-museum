// state.js — 会话状态对象、localStorage 持久化、步骤迁移守卫、delta/feedback 纯逻辑。
// 本模块不依赖 DOM：storage 可注入，便于 node --test（tests/unit/web-state.test.mjs）。

export const SCHEMA_VERSION = '1.0.0';
export const SESSION_KEY = 'ink-museum.session.v1';
export const LOCAL_GALLERY_KEY = 'ink-museum.gallery.v1';
export const STEPS = ['enter', 'pre', 'scene', 'line', 'ink', 'post', 'reveal'];
export const SCALE_KEYS = ['tight', 'tired', 'scattered'];
export const SCALE_MIN = 1;
export const SCALE_MAX = 7;

let stateIdFallback = 0;

export function nowIso() {
  return new Date().toISOString();
}

export function stepIndex(step) {
  return STEPS.indexOf(step);
}

export function newClientId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  let buffer = null;
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    buffer = new Uint8Array(16);
    cryptoObj.getRandomValues(buffer);
  }
  for (let i = 0; i < 16; i += 1) {
    const n = buffer ? buffer[i] % alphabet.length : Math.floor(Math.random() * alphabet.length);
    out += alphabet[n];
  }
  return 'im_' + out;
}

export function isClientId(value) {
  return typeof value === 'string' && /^im_[a-z0-9]{8,32}$/.test(value);
}

export function isIsoDate(value) {
  if (typeof value !== 'string' || value.length < 10) return false;
  const time = Date.parse(value);
  return Number.isFinite(time);
}

export function normalizeScale(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < SCALE_MIN || n > SCALE_MAX) return null;
  return n;
}

export function normalizeScales(raw) {
  const out = { tight: null, tired: null, scattered: null };
  if (!raw || typeof raw !== 'object') return out;
  for (let i = 0; i < SCALE_KEYS.length; i += 1) {
    out[SCALE_KEYS[i]] = normalizeScale(raw[SCALE_KEYS[i]]);
  }
  return out;
}

export function normalizeMood(value, allowedKeys) {
  if (typeof value !== 'string') return null;
  if (!Array.isArray(allowedKeys) || allowedKeys.length === 0) return null;
  return allowedKeys.indexOf(value) >= 0 ? value : null;
}

export function normalizeAnswer(value, allowedKeys) {
  if (typeof value !== 'string') return null;
  if (!Array.isArray(allowedKeys) || allowedKeys.length === 0) return null;
  return allowedKeys.indexOf(value) >= 0 ? value : null;
}

export function normalizeInkStats(raw) {
  const out = { strokes: 0, stamps: 0, ms: 0 };
  if (!raw || typeof raw !== 'object') return out;
  const fields = ['strokes', 'stamps', 'ms'];
  for (let i = 0; i < fields.length; i += 1) {
    const n = Math.round(Number(raw[fields[i]]));
    out[fields[i]] = Number.isFinite(n) && n >= 0 ? n : 0;
  }
  return out;
}

export function createSession(timeSeed) {
  return {
    schemaVersion: SCHEMA_VERSION,
    clientId: newClientId(),
    startedAt: typeof timeSeed === 'string' ? timeSeed : nowIso(),
    finishedAt: null,
    step: 'enter',
    sceneId: null,
    pre: { tight: null, tired: null, scattered: null },
    post: { tight: null, tired: null, scattered: null, mood: null },
    line: { answer: null, round: 0 },
    ink: { strokes: 0, stamps: 0, ms: 0 },
    flags: { sound: false }
  };
}

export function isPreComplete(session) {
  if (!session || !session.pre) return false;
  return SCALE_KEYS.every((key) => normalizeScale(session.pre[key]) !== null);
}

export function isPostComplete(session) {
  if (!session || !session.post) return false;
  return (
    SCALE_KEYS.every((key) => normalizeScale(session.post[key]) !== null) &&
    typeof session.post.mood === 'string' &&
    session.post.mood.length > 0
  );
}

// 一致性守卫：根据已有数据判断某个 step 是否成立；不成立则回退到最近的可用 step。
export function guardStep(session, step) {
  let next = STEPS.indexOf(step) >= 0 ? step : 'enter';
  if (stepIndex(next) >= stepIndex('scene') && !isPreComplete(session)) next = 'pre';
  if (stepIndex(next) >= stepIndex('line') && !session.sceneId) next = 'scene';
  if (stepIndex(next) >= stepIndex('ink') && !session.line.answer) next = 'line';
  if (stepIndex(next) >= stepIndex('post') && !session.line.answer) next = 'line';
  return next;
}

// 恢复守卫（纯函数）：
// 输入 localStorage 原始对象，输出 { session, note }；
// note = null | 'reset'（数据不可用，重开）| 'dryInk'（墨迹不恢复，回 scene）。
export function migrateSession(raw, env) {
  const cfg = env || {};
  const now = typeof cfg.now === 'string' ? cfg.now : nowIso();
  const sceneIds = Array.isArray(cfg.sceneIds) ? cfg.sceneIds : [];
  const moodKeys = Array.isArray(cfg.moodKeys) ? cfg.moodKeys : [];
  const answerKeys = Array.isArray(cfg.answerKeys) ? cfg.answerKeys : [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { session: createSession(now), note: 'reset' };
  }

  if (raw.schemaVersion !== SCHEMA_VERSION) {
    const fresh = createSession(now);
    if (isClientId(raw.clientId)) fresh.clientId = raw.clientId;
    return { session: fresh, note: 'reset' };
  }

  const session = createSession(now);
  session.clientId = isClientId(raw.clientId) ? raw.clientId : session.clientId;
  session.startedAt = isIsoDate(raw.startedAt) ? raw.startedAt : session.startedAt;
  session.finishedAt = isIsoDate(raw.finishedAt) ? raw.finishedAt : null;
  session.flags = { sound: Boolean(raw.flags && raw.flags.sound === true) };
  session.pre = normalizeScales(raw.pre);
  session.post = normalizeScales(raw.post);
  session.post.mood = normalizeMood(raw.post && raw.post.mood, moodKeys);
  session.line = {
    answer: normalizeAnswer(raw.line && raw.line.answer, answerKeys),
    round: raw.line && raw.line.round === 1 ? 1 : 0
  };
  session.ink = normalizeInkStats(raw.ink);
  session.sceneId = sceneIds.indexOf(raw.sceneId) >= 0 ? raw.sceneId : null;

  let step = STEPS.indexOf(raw.step) >= 0 ? raw.step : 'enter';
  let note = STEPS.indexOf(raw.step) >= 0 ? null : 'reset';

  // 落墨之后的墨迹无法从 localStorage 恢复：提示「墨已干」并回到择境。
  if (stepIndex(step) >= stepIndex('ink')) {
    note = 'dryInk';
    session.sceneId = null;
    session.line = { answer: null, round: 0 };
    session.post = { tight: null, tired: null, scattered: null, mood: null };
    session.ink = { strokes: 0, stamps: 0, ms: 0 };
    session.finishedAt = null;
    step = 'scene';
  }

  step = guardStep(session, step);
  session.step = step;
  return { session, note };
}

export function resolveStorage() {
  try {
    const storage = typeof globalThis !== 'undefined' ? globalThis.localStorage : null;
    return storage || null;
  } catch (err) {
    return null;
  }
}

export function loadRawSession(storage) {
  const store = storage || resolveStorage();
  if (!store) return null;
  try {
    const text = store.getItem(SESSION_KEY);
    if (!text) return null;
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

export function saveSession(storage, session) {
  const store = storage || resolveStorage();
  if (!store) return false;
  try {
    store.setItem(SESSION_KEY, JSON.stringify(session));
    return true;
  } catch (err) {
    return false;
  }
}

export function clearSession(storage) {
  const store = storage || resolveStorage();
  if (!store) return;
  try {
    store.removeItem(SESSION_KEY);
  } catch (err) {
    /* ignore */
  }
}

export function loadLocalGallery(storage) {
  const store = storage || resolveStorage();
  if (!store) return [];
  try {
    const text = store.getItem(LOCAL_GALLERY_KEY);
    if (!text) return [];
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

export function saveLocalGallery(storage, items) {
  const store = storage || resolveStorage();
  if (!store) return false;
  try {
    store.setItem(LOCAL_GALLERY_KEY, JSON.stringify(items));
    return true;
  } catch (err) {
    return false;
  }
}

export function clearAll(storage) {
  const store = storage || resolveStorage();
  if (store) {
    try {
      store.removeItem(SESSION_KEY);
    } catch (err) {
      /* ignore */
    }
    try {
      store.removeItem(LOCAL_GALLERY_KEY);
    } catch (err) {
      /* ignore */
    }
  }
  try {
    const cacheStore = typeof globalThis !== 'undefined' ? globalThis.caches : null;
    if (cacheStore && typeof cacheStore.keys === 'function') {
      cacheStore
        .keys()
        .then((keys) => Promise.all(keys.map((key) => cacheStore.delete(key))))
        .catch(() => {});
    }
  } catch (err) {
    /* ignore */
  }
}

// ---------- 步骤迁移（前进/后退守卫） ----------

export function isValidTransition(from, to) {
  const a = stepIndex(from);
  const b = stepIndex(to);
  if (a < 0 || b < 0) return false;
  if (from === 'reveal') return false;
  return b === a + 1 || b === a - 1;
}

export function canGoBack(step) {
  return stepIndex(step) > 0 && step !== 'reveal';
}

export function backStep(step) {
  if (!canGoBack(step)) return null;
  return STEPS[stepIndex(step) - 1];
}

export function nextStepOf(step) {
  const i = stepIndex(step);
  if (i < 0 || i >= STEPS.length - 1) return null;
  return STEPS[i + 1];
}

// 重走一厅：保留匿名编号与「来时」，清空此后的一切。
export function resetForReplay(session) {
  const fresh = createSession();
  fresh.clientId = session.clientId;
  fresh.startedAt = nowIso();
  fresh.flags = { sound: Boolean(session.flags && session.flags.sound) };
  const pre = normalizeScales(session.pre);
  fresh.pre = pre;
  fresh.step = 'scene';
  return fresh;
}

// 完全重开（清空本机记录后）：回到入馆。
export function resetAll(session) {
  const fresh = createSession();
  fresh.clientId = session.clientId;
  return fresh;
}

// ---------- 前后变化：delta / 三墨点 / feedback ----------

export function computeDelta(pre, post) {
  const out = { tight: 0, tired: 0, scattered: 0, total: 0, known: 0, maxAbs: 0 };
  for (let i = 0; i < SCALE_KEYS.length; i += 1) {
    const key = SCALE_KEYS[i];
    const before = normalizeScale(pre && pre[key]);
    const after = normalizeScale(post && post[key]);
    if (before === null || after === null) continue;
    const diff = before - after; // 正数 = 松了一点
    out[key] = diff;
    out.total += diff;
    out.known += 1;
    out.maxAbs = Math.max(out.maxAbs, Math.abs(diff));
  }
  return out;
}

export function feedbackKey(total) {
  if (total > 0) return 'better';
  if (total < 0) return 'worse';
  return 'same';
}

export function hashSeed(text) {
  const source = String(text || '');
  let h = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pickFeedback(delta, feedbackContent, seedText) {
  const total = delta && Number.isFinite(Number(delta.total)) ? Number(delta.total) : 0;
  const key = feedbackKey(total);
  const groups = feedbackContent || {};
  let list = groups[key];
  if (!Array.isArray(list) || list.length === 0) list = groups.same;
  if (!Array.isArray(list) || list.length === 0) return '';
  const seed = hashSeed(seedText);
  return list[seed % list.length];
}

export function dotPlan(pre, post) {
  const delta = computeDelta(pre, post);
  return SCALE_KEYS.map((key) => {
    const diff = delta[key];
    let tone = 'same';
    if (diff > 0) tone = 'better';
    else if (diff < 0) tone = 'worse';
    return { key, delta: diff, tone };
  });
}