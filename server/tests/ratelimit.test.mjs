// 墨馆后端 · 限流测试（滑动窗口 / 保存 / 读 / env 可调 / RATE_LIMIT=off / TRUST_PROXY）
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../ratelimit.mjs';
import { startTestApp, postScroll, samplePayload, fetchJson } from './helpers.mjs';

const postAs = (baseUrl, ip, key) => fetch(`${baseUrl}/api/scrolls`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'idempotency-key': key,
    'x-forwarded-for': ip
  },
  body: JSON.stringify(samplePayload())
});

test('createRateLimiter：超限给 Retry-After，窗口滚过后恢复', () => {
  const limiter = createRateLimiter({ max: 2, windowMs: 1000, name: 'unit' });
  assert.equal(limiter.consume('ip', 0).allowed, true);
  assert.equal(limiter.consume('ip', 100).allowed, true);
  const denied = limiter.consume('ip', 200);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSec, 1);
  // 第一条（t=0）在 t=1000 时正好滑出窗口
  assert.equal(limiter.consume('ip', 1000).allowed, true);
  // 其他 key 不受影响
  assert.equal(limiter.consume('other', 1000).allowed, true);
});

test('保存限流默认 6 次/10 分钟：第 7 次 429 + Retry-After，窗口过后恢复', async (t) => {
  let now = 1_000_000;
  const { baseUrl } = await startTestApp(t, { env: {}, now: () => now });
  for (let index = 0; index < 6; index += 1) {
    const response = await postScroll(baseUrl, samplePayload());
    assert.equal(response.status, 201, `第 ${index + 1} 次应成功`);
  }
  const denied = await postScroll(baseUrl, samplePayload());
  assert.equal(denied.status, 429);
  const retryAfter = Number(denied.headers.get('retry-after'));
  assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1);
  const body = await denied.json();
  assert.equal(body.error.code, 'rate_limited');

  now += 10 * 60 * 1000 + 1;
  const recovered = await postScroll(baseUrl, samplePayload());
  assert.equal(recovered.status, 201);
});

test('环境变量 SAVE_LIMIT_MAX=2 生效：第 3 次保存 429（QA 可调，不打架）', async (t) => {
  const { baseUrl } = await startTestApp(t, { env: { SAVE_LIMIT_MAX: '2' } });
  assert.equal((await postScroll(baseUrl, samplePayload())).status, 201);
  assert.equal((await postScroll(baseUrl, samplePayload())).status, 201);
  const denied = await postScroll(baseUrl, samplePayload());
  assert.equal(denied.status, 429);
  assert.ok(Number(denied.headers.get('retry-after')) >= 1);
});

test('RATE_LIMIT=off：限流完全关闭（连存 8 条也全 201）', async (t) => {
  const { baseUrl } = await startTestApp(t, { env: { RATE_LIMIT: 'off' } });
  for (let index = 0; index < 8; index += 1) {
    const response = await postScroll(baseUrl, samplePayload());
    assert.equal(response.status, 201, `RATE_LIMIT=off 时第 ${index + 1} 次应成功`);
  }
  const health = await fetchJson(`${baseUrl}/api/health`);
  assert.equal(health.body.features.rateLimit, false);
});

test('读限流：超限 429 + Retry-After；/api/health 不参与读限流', async (t) => {
  const { baseUrl } = await startTestApp(t, { env: {}, limits: { read: { max: 3, windowMs: 60_000 } } });
  assert.equal((await fetchJson(`${baseUrl}/api/scrolls`)).status, 200);
  assert.equal((await fetchJson(`${baseUrl}/api/content`)).status, 200);
  assert.equal((await fetchJson(`${baseUrl}/api/stats`)).status, 200);
  const denied = await fetchJson(`${baseUrl}/api/scrolls`);
  assert.equal(denied.status, 429);
  assert.ok(Number(denied.headers.get('retry-after')) >= 1);
  assert.equal(denied.body.error.code, 'rate_limited');
  // 健康检查豁免（前端 800ms 探测依赖它）
  assert.equal((await fetchJson(`${baseUrl}/api/health`)).status, 200);
});

test('TRUST_PROXY=1 时才按 x-forwarded-for 分桶', async (t) => {
  // 默认不信任代理：XFF 被忽略，同一个 socket 桶 → 第 2 个请求 429
  const noTrust = await startTestApp(t, { env: {}, limits: { save: { max: 1, windowMs: 60_000 } } });
  assert.equal((await postAs(noTrust.baseUrl, '1.1.1.1', 'xff-a-1')).status, 201);
  assert.equal((await postAs(noTrust.baseUrl, '2.2.2.2', 'xff-a-2')).status, 429);

  // TRUST_PROXY=1：不同 XFF 各自分桶
  const trust = await startTestApp(t, { env: { TRUST_PROXY: '1' }, limits: { save: { max: 1, windowMs: 60_000 } } });
  assert.equal((await postAs(trust.baseUrl, '1.1.1.1', 'xff-b-1')).status, 201);
  assert.equal((await postAs(trust.baseUrl, '2.2.2.2', 'xff-b-2')).status, 201);
  assert.equal((await postAs(trust.baseUrl, '1.1.1.1', 'xff-b-3')).status, 429);
});