// 墨馆后端 · API 主流程测试（health/content/保存/幂等/列表/详情/图片/统计）
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  CONTENT,
  RELAXED_LIMITS,
  startTestApp,
  saveScroll,
  postScroll,
  fetchJson,
  samplePayload,
  makeWebpBytes,
  makePngBytes,
  dataUrlFor,
  readRecords
} from './helpers.mjs';
import { CSP_POLICY } from '../security.mjs';

test('GET /api/health 返回 ok/mode/version 并带全套安全响应头', async (t) => {
  const { baseUrl } = await startTestApp(t);
  const result = await fetchJson(`${baseUrl}/api/health`);
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.mode, 'server');
  assert.equal(typeof result.body.version, 'string');
  assert.equal(result.body.contentVersion, CONTENT.version);
  assert.equal(result.headers.get('content-security-policy'), CSP_POLICY);
  assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
  assert.match(result.headers.get('permissions-policy'), /camera=\(\)/);
  assert.equal(result.headers.get('cache-control'), 'no-store');
});

test('GET /api/content 返回 content/content.js 的完整对象', async (t) => {
  const { baseUrl } = await startTestApp(t);
  const result = await fetchJson(`${baseUrl}/api/content`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, JSON.parse(JSON.stringify(CONTENT)));
  assert.equal(result.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(result.headers.get('cache-control'), 'no-cache');
});

test('POST 合法画卷 → 201，并能在详情/列表/图片/统计/落盘记录中读到', async (t) => {
  const { baseUrl, dataDir } = await startTestApp(t);
  const payload = samplePayload();

  const save = await fetchJson(`${baseUrl}/api/scrolls`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'flow-key-1' },
    body: JSON.stringify(payload)
  });
  assert.equal(save.status, 201);
  assert.match(save.body.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(save.body.imageUrl, `/api/scrolls/${save.body.id}/image.webp`);
  assert.ok(!Number.isNaN(Date.parse(save.body.createdAt)));

  const detail = await fetchJson(`${baseUrl}/api/scrolls/${save.body.id}`);
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.pre, payload.pre);
  assert.equal(detail.body.mood, payload.mood);
  assert.deepEqual(detail.body.ink, payload.ink);
  assert.equal(detail.body.schemaVersion, payload.schemaVersion);
  assert.equal(detail.body.contentVersion, CONTENT.version);
  assert.match(detail.body.clientIdHash, /^[0-9a-f]{16}$/);
  assert.equal('clientId' in detail.body, false, '详情不应暴露原始 clientId');

  const list = await fetchJson(`${baseUrl}/api/scrolls`);
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 1);
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].id, save.body.id);
  assert.equal(list.body.items[0].imageUrl, save.body.imageUrl);
  assert.equal(list.body.nextCursor, null);

  const imageResponse = await fetch(`${baseUrl}${save.body.imageUrl}`);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get('content-type'), 'image/webp');
  assert.equal(imageResponse.headers.get('cache-control'), 'public, max-age=3600');
  assert.equal(imageResponse.headers.get('x-content-type-options'), 'nosniff');
  const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
  assert.deepEqual(imageBytes, makeWebpBytes(256));

  const stats = await fetchJson(`${baseUrl}/api/stats`);
  assert.equal(stats.status, 200);
  assert.equal(stats.body.total, 1);
  assert.deepEqual(stats.body.byScene, { [payload.sceneId]: 1 });
  assert.deepEqual(stats.body.byMood, { [payload.mood]: 1 });
  assert.equal(stats.body.badLines, 0);

  const records = await readRecords(dataDir);
  assert.equal(records.length, 1);
  assert.equal(records[0].schemaVersion, payload.schemaVersion);
  assert.equal(records[0].contentVersion, CONTENT.version);
  assert.equal(records[0].createdAt, save.body.createdAt);
  assert.equal(records[0].clientId, payload.clientId);
  assert.equal(records[0].image.type, 'webp');
  assert.equal(records[0].image.bytes, makeWebpBytes(256).length);
});

test('Idempotency-Key 重放返回同一条（200 + Idempotent-Replay）', async (t) => {
  const { baseUrl } = await startTestApp(t);
  const payload = samplePayload();
  const headers = { 'content-type': 'application/json', 'idempotency-key': 'replay-key-1' };

  const first = await fetchJson(`${baseUrl}/api/scrolls`, { method: 'POST', headers, body: JSON.stringify(payload) });
  assert.equal(first.status, 201);
  const second = await fetchJson(`${baseUrl}/api/scrolls`, { method: 'POST', headers, body: JSON.stringify(payload) });
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('idempotent-replay'), 'true');
  assert.equal(second.body.id, first.body.id);
  assert.equal(second.body.createdAt, first.body.createdAt);

  const list = await fetchJson(`${baseUrl}/api/scrolls`);
  assert.equal(list.body.total, 1);
});

test('同一 Idempotency-Key 换内容 → 409 idempotency_conflict', async (t) => {
  const { baseUrl } = await startTestApp(t);
  const firstPayload = samplePayload();
  const secondPayload = samplePayload();
  secondPayload.ink = { strokes: 99, stamps: 0, ms: 1000 };
  const headers = { 'content-type': 'application/json', 'idempotency-key': 'conflict-key-1' };

  const first = await fetchJson(`${baseUrl}/api/scrolls`, { method: 'POST', headers, body: JSON.stringify(firstPayload) });
  assert.equal(first.status, 201);
  const second = await fetchJson(`${baseUrl}/api/scrolls`, { method: 'POST', headers, body: JSON.stringify(secondPayload) });
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'idempotency_conflict');
  const list = await fetchJson(`${baseUrl}/api/scrolls`);
  assert.equal(list.body.total, 1);
});

test('同 key 并发请求合流：只落一条记录、返回同一个 id', async (t) => {
  const { baseUrl } = await startTestApp(t);
  const payload = samplePayload();
  const headers = { 'content-type': 'application/json', 'idempotency-key': 'concurrent-key-1' };
  const results = await Promise.all(
    Array.from({ length: 3 }, () => fetchJson(`${baseUrl}/api/scrolls`, { method: 'POST', headers, body: JSON.stringify(payload) }))
  );
  const statuses = results.map((result) => result.status).sort();
  assert.deepEqual(statuses, [200, 200, 201]);
  const ids = new Set(results.map((result) => result.body.id));
  assert.equal(ids.size, 1);
  const list = await fetchJson(`${baseUrl}/api/scrolls`);
  assert.equal(list.body.total, 1);
});

test('PNG data URL 也接受，图片按 image/png 提供', async (t) => {
  const { baseUrl } = await startTestApp(t);
  const pngBytes = makePngBytes(512);
  const payload = samplePayload({ image: dataUrlFor('png', pngBytes) });
  const result = await fetchJson(`${baseUrl}/api/scrolls`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'png-key-1' },
    body: JSON.stringify(payload)
  });
  assert.equal(result.status, 201);
  assert.match(result.body.imageUrl, /\/image\.png$/);
  const imageResponse = await fetch(`${baseUrl}${result.body.imageUrl}`);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), pngBytes);
  // 单一语义：png 记录请求 .webp 路由 → 404
  assert.equal((await fetch(`${baseUrl}/api/scrolls/${result.body.id}/image.webp`)).status, 404);
});

test('列表分页、scene 过滤与非法查询参数', async (t) => {
  const { baseUrl } = await startTestApp(t, { limits: RELAXED_LIMITS });
  const sceneA = CONTENT.scenes[0].id;
  const sceneB = CONTENT.scenes[1].id;
  const firstA = await saveScroll(baseUrl, { sceneId: sceneA });
  const onlyB = await saveScroll(baseUrl, { sceneId: sceneB });
  const secondA = await saveScroll(baseUrl, { sceneId: sceneA });

  const page1 = await fetchJson(`${baseUrl}/api/scrolls?limit=2`);
  assert.equal(page1.status, 200);
  assert.equal(page1.body.total, 3);
  assert.equal(page1.body.items.length, 2);
  assert.equal(typeof page1.body.nextCursor, 'string');
  // 倒序：最新保存的在最前
  assert.equal(page1.body.items[0].id, secondA.id);
  assert.equal(page1.body.items[1].id, onlyB.id);

  const page2 = await fetchJson(`${baseUrl}/api/scrolls?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`);
  assert.equal(page2.status, 200);
  assert.equal(page2.body.items.length, 1);
  assert.equal(page2.body.items[0].id, firstA.id);
  assert.equal(page2.body.nextCursor, null);

  const filtered = await fetchJson(`${baseUrl}/api/scrolls?scene=${sceneB}`);
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.total, 1);
  assert.equal(filtered.body.items[0].id, onlyB.id);

  assert.equal((await fetchJson(`${baseUrl}/api/scrolls?scene=nope`)).status, 400);
  assert.equal((await fetchJson(`${baseUrl}/api/scrolls?limit=0`)).status, 400);
  assert.equal((await fetchJson(`${baseUrl}/api/scrolls?limit=abc`)).status, 400);
  assert.equal((await fetchJson(`${baseUrl}/api/scrolls?cursor=not-a-cursor`)).status, 400);
});

test('详情与图片 404 返回 JSON 错误体且不泄漏堆栈', async (t) => {
  const { baseUrl } = await startTestApp(t);
  const missing = crypto.randomUUID();
  const detail = await fetchJson(`${baseUrl}/api/scrolls/${missing}`);
  assert.equal(detail.status, 404);
  assert.equal(detail.body.error.code, 'scroll_not_found');
  assert.equal(detail.body.error.message.length > 0, true);
  assert.equal(JSON.stringify(detail.body).includes('at Server.'), false);

  const image = await fetchJson(`${baseUrl}/api/scrolls/${missing}/image.webp`);
  assert.equal(image.status, 404);

  const malformed = await fetchJson(`${baseUrl}/api/scrolls/..%2f..%2fetc%2fpasswd`);
  assert.equal(malformed.status, 404);
  assert.equal(malformed.body.error.code, 'scroll_not_found');
});

test('顶层任意自由文本字段被忽略、不落盘（不做 UGC）', async (t) => {
  const { baseUrl, dataDir } = await startTestApp(t);
  const payload = samplePayload({
    text: '你好，我叫小王',
    note: { hello: 'world' },
    answer: ['a'],
    nickname: '匿名者'
  });
  const result = await fetchJson(`${baseUrl}/api/scrolls`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'ugc-key-1' },
    body: JSON.stringify(payload)
  });
  assert.equal(result.status, 201);

  const records = await readRecords(dataDir);
  assert.equal(records.length, 1);
  assert.equal('text' in records[0], false);
  assert.equal('note' in records[0], false);
  assert.equal('answer' in records[0], false);
  assert.equal('nickname' in records[0], false);
  const raw = JSON.stringify(records[0]);
  assert.equal(raw.includes('小王'), false, '自由文本不得落盘');
  assert.equal(raw.includes('匿名者'), false, '自由文本不得落盘');

  const detail = await fetchJson(`${baseUrl}/api/scrolls/${result.body.id}`);
  assert.equal(detail.status, 200);
  assert.equal('text' in detail.body, false);
});

test('ink 上多余字段被忽略（如引擎 stats 的 inkCoverage）', async (t) => {
  const { baseUrl, dataDir } = await startTestApp(t);
  const payload = samplePayload();
  payload.ink = { strokes: 1, stamps: 0, ms: 1000, inkCoverage: 0.5 };
  const result = await fetchJson(`${baseUrl}/api/scrolls`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'ink-extra-key-1' },
    body: JSON.stringify(payload)
  });
  assert.equal(result.status, 201);
  const [record] = await readRecords(dataDir);
  assert.deepEqual(record.ink, { strokes: 1, stamps: 0, ms: 1000 });
});

test('未知 /api 路径 → 404 JSON；错误方法 → 405 + Allow', async (t) => {
  const { baseUrl } = await startTestApp(t);
  const unknown = await fetchJson(`${baseUrl}/api/nope`);
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, 'not_found');

  const wrongMethod = await fetch(`${baseUrl}/api/health`, { method: 'POST' });
  assert.equal(wrongMethod.status, 405);
  assert.match(wrongMethod.headers.get('allow'), /GET/);
  const body = await wrongMethod.json();
  assert.equal(body.error.code, 'method_not_allowed');
});