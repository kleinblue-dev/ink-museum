// 墨馆后端 · POST /api/scrolls 载荷校验
// 原则：只承认白名单字段；不接收任何自由文本（顶层多余字段一律忽略，不落盘）；
//       pre/post 只允许规定键；图片 data URL ≤2.5MB 且 magic 必须匹配。
import { HttpError } from './http-util.mjs';
import { decodeImageDataUrl, sha256Hex } from './media.mjs';
import { SCALE_KEYS, POST_KEYS, sceneIdSet, moodKeySet, contentMajor } from './content.mjs';

/** mm_slug：im_ + 8..32 位小写字母数字 */
export const CLIENT_ID_RE = /^im_[a-z0-9]{8,32}$/;
/** MAJOR.MINOR.PATCH，可带 pre-release / build 后缀 */
const SCHEMA_RE = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/;

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function fail(code, message) {
  return new HttpError(400, code, message);
}

/** 校验 pre/post 的三个 1..7 整数量表字段 */
function readScale(value, field, allowedKeys) {
  if (!isPlainObject(value)) throw fail(`invalid_${field}`, `${field} 必须是对象`);
  const normalized = {};
  for (const key of SCALE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw fail(`invalid_${field}`, `${field}.${key} 缺失（需要 1..7 的整数）`);
    }
    const number = value[key];
    if (!Number.isInteger(number) || number < 1 || number > 7) {
      throw fail(`invalid_${field}`, `${field}.${key} 必须是 1..7 的整数`);
    }
    normalized[key] = number;
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw fail(`invalid_${field}`, `${field} 不允许字段 ${JSON.stringify(key)}`);
    }
  }
  return normalized;
}

function readSchemaVersion(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw fail('invalid_schema_version', 'schemaVersion 必须是字符串（例如 "1.0.0"）');
  }
  const text = value.trim();
  const match = SCHEMA_RE.exec(text);
  if (!match) throw fail('invalid_schema_version', 'schemaVersion 必须是 MAJOR.MINOR.PATCH 形式');
  if (match[1] !== contentMajor) {
    throw fail('incompatible_schema_version', `schemaVersion 主版本必须是 ${contentMajor}.x.x，收到 ${text}`);
  }
  return text;
}

function readClientId(value) {
  if (typeof value !== 'string' || !CLIENT_ID_RE.test(value)) {
    throw fail('invalid_client_id', 'clientId 必须匹配 im_[a-z0-9]{8,32}');
  }
  return value;
}

function readSceneId(value) {
  if (typeof value !== 'string' || !sceneIdSet.has(value)) {
    throw fail('invalid_scene', 'sceneId 不在 content.scenes 中');
  }
  return value;
}

function readMood(body, postValue) {
  const topLevel = body.mood;
  if (topLevel !== undefined && topLevel !== null) {
    if (typeof topLevel !== 'string' || !moodKeySet.has(topLevel)) {
      throw fail('invalid_mood', 'mood 不在 content.post.moods 中');
    }
  }
  const insidePost = isPlainObject(postValue) ? postValue.mood : undefined;
  if (insidePost !== undefined && insidePost !== null) {
    if (typeof insidePost !== 'string' || !moodKeySet.has(insidePost)) {
      throw fail('invalid_mood', 'post.mood 不在 content.post.moods 中');
    }
  }
  if (topLevel !== undefined && topLevel !== null && insidePost !== undefined && insidePost !== null && topLevel !== insidePost) {
    throw fail('mood_conflict', 'mood 与 post.mood 不一致');
  }
  const mood = topLevel ?? insidePost;
  if (mood === undefined || mood === null) throw fail('missing_mood', '缺少 mood（content.post.moods 之一）');
  return mood;
}

function readInk(value, maxInkValue) {
  if (!isPlainObject(value)) throw fail('invalid_ink', 'ink 必须是对象');
  const ink = {};
  for (const key of ['strokes', 'stamps', 'ms']) {
    const number = value[key];
    if (!Number.isInteger(number) || number < 0 || number > maxInkValue) {
      throw fail('invalid_ink', `ink.${key} 必须是 0..${maxInkValue} 的整数`);
    }
    ink[key] = number;
  }
  return ink; // 忽略 ink 上多余字段（如引擎 stats 的 inkCoverage），不落盘
}

/**
 * 校验并归一化 POST /api/scrolls 的 body。
 * @param {unknown} body
 * @param {{maxImageBytes: number, maxInkValue: number}} options
 */
export function validateScrollPayload(body, { maxImageBytes, maxInkValue }) {
  if (!isPlainObject(body)) throw fail('invalid_body', '请求体必须是 JSON 对象');

  const schemaVersion = readSchemaVersion(body.schemaVersion);
  const clientId = readClientId(body.clientId);
  const sceneId = readSceneId(body.sceneId);
  const pre = readScale(body.pre, 'pre', SCALE_KEYS);
  const postScales = readScale(body.post, 'post', POST_KEYS);
  const mood = readMood(body, body.post);
  const ink = readInk(body.ink, maxInkValue);
  const image = decodeImageDataUrl(body.image, { maxBytes: maxImageBytes });

  return {
    schemaVersion,
    clientId,
    clientIdHash: sha256Hex(clientId).slice(0, 16),
    sceneId,
    mood,
    pre,
    post: { ...postScales, mood },
    ink,
    image
  };
}

/** 幂等指纹：内容一致的判定依据（含图片哈希） */
export function payloadFingerprint(normalized) {
  const core = {
    schemaVersion: normalized.schemaVersion,
    clientId: normalized.clientId,
    sceneId: normalized.sceneId,
    mood: normalized.mood,
    pre: normalized.pre,
    post: normalized.post,
    ink: normalized.ink
  };
  return sha256Hex(`${JSON.stringify(core)}\n${normalized.image.sha256}`);
}