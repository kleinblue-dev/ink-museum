// 墨馆后端 · 滑动窗口限流（内存实现，单进程）
const SWEEP_EVERY = 512;

/**
 * @param {{max: number, windowMs: number, name?: string}} options
 */
export function createRateLimiter({ max, windowMs, name = 'limiter' }) {
  if (!Number.isInteger(max) || max <= 0) throw new Error(`${name}: max 必须是正整数`);
  if (!Number.isInteger(windowMs) || windowMs <= 0) throw new Error(`${name}: windowMs 必须是正整数`);
  /** @type {Map<string, number[]>} */
  const hits = new Map();
  let operations = 0;

  function sweep(now) {
    for (const [key, timestamps] of hits) {
      const kept = timestamps.filter((time) => now - time < windowMs);
      if (kept.length === 0) hits.delete(key);
      else if (kept.length !== timestamps.length) hits.set(key, kept);
    }
  }

  return {
    get size() {
      return hits.size;
    },
    /**
     * 记一次请求；超限时返回 Retry-After 秒数。
     * @param {string} key
     * @param {number} [now]
     */
    consume(key, now = Date.now()) {
      operations += 1;
      if (operations % SWEEP_EVERY === 0) sweep(now);
      let timestamps = hits.get(key);
      if (!timestamps) {
        timestamps = [];
        hits.set(key, timestamps);
      }
      while (timestamps.length > 0 && now - timestamps[0] >= windowMs) timestamps.shift();
      if (timestamps.length >= max) {
        const retryAfterMs = timestamps[0] + windowMs - now;
        return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
      }
      timestamps.push(now);
      return { allowed: true, remaining: max - timestamps.length, retryAfterSec: 0 };
    },
    reset() {
      hits.clear();
    }
  };
}

/** RATE_LIMIT=off 时使用：永远放行（接口形状与真实 limiter 一致） */
export function createNoopLimiter(name = 'noop') {
  return {
    name,
    get size() {
      return 0;
    },
    consume() {
      return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, retryAfterSec: 0 };
    },
    reset() {
      /* 无状态 */
    }
  };
}