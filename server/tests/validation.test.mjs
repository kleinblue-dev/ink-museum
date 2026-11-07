// 墨馆后端 · POST /api/scrolls 校验边界测试（400/413 与错误码）
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT,
  RELAXED_LIMITS,
  startTestApp,
  samplePayload,
  postScroll,
  dataUrlFor,
  makeWebpBytes,
  makePngBytes
} from './helpers.mjs';

async function app(t) {
  const ctx = await startTestApp(t, { env: {}, limits: RELAXED_LIMITS });
  return ctx.baseUrl;
}

async function expectError(baseUrl, response, status, code) {
  assert.equal(response.status, status, `期望 HTTP ${status}，实际 ${response.status}`);
  const body = await response.json();
  assert.equal(body.error?.code, code, `期望错误码 ${code}，实际 ${JSON.stringify(body)}`);
  return body;
}

test('缺少 / 空 Idempotency-Key → 400', async (t) => {
  const baseUrl = await app(t);
  await expectError(baseUrl, await postScroll(baseUrl, samplePayload(), { key: null }), 400, 'missing_idempotency_key');
  await expectError(baseUrl, await postScroll(baseUrl, samplePayload(), { key: '   ' }), 400, 'missing_idempotency_key');
});

test('非法 JSON / 非对象 body / 错 Content-Type', async (t) => {
  const baseUrl = await app(t);
  await expectError(
    baseUrl,
    await postScroll(baseUrl, samplePayload(), { body: '{not json' }),
    400,
    'invalid_json'
  );
  await expectError(baseUrl, await postScroll(baseUrl, samplePayload(), { body: '[]' }), 400, 'invalid_body');
  await expectError(baseUrl, await postScroll(baseUrl, samplePayload(), { body: 'null' }), 400, 'invalid_body');
  const wrongType = await postScroll(baseUrl, samplePayload(), { headers: { 'content-type': 'text/plain' } });
  await expectError(baseUrl, wrongType, 415, 'unsupported_media_type');
});

test('schemaVersion 主版本不匹配 / 格式错误', async (t) => {
  const baseUrl = await app(t);
  const major = Number(CONTENT.version.split('.')[0]);
  const incompatible = samplePayload({ schemaVersion: `${major + 1}.0.0` });
  await expectError(baseUrl, await postScroll(baseUrl, incompatible), 400, 'incompatible_schema_version');
  const malformed = samplePayload({ schemaVersion: '1.0' });
  await expectError(baseUrl, await postScroll(baseUrl, malformed), 400, 'invalid_schema_version');
  const missing = samplePayload();
  delete missing.schemaVersion;
  await expectError(baseUrl, await postScroll(baseUrl, missing), 400, 'invalid_schema_version');
});

test('clientId 格式：必须 im_[a-z0-9]{8,32}', async (t) => {
  const baseUrl = await app(t);
  for (const bad of ['im_ABC12345', 'im_short', 'xx_12345678', 'im_' + 'a'.repeat(33), 'im_中文中文中文']) {
    await expectError(baseUrl, await postScroll(baseUrl, samplePayload({ clientId: bad })), 400, 'invalid_client_id');
  }
});

test('sceneId 必须属于 content.scenes', async (t) => {
  const baseUrl = await app(t);
  await expectError(baseUrl, await postScroll(baseUrl, samplePayload({ sceneId: 'not-a-scene' })), 400, 'invalid_scene');
});

test('pre 校验：缺字段 / 越界 / 非整数 / 未知键', async (t) => {
  const baseUrl = await app(t);
  const cases = [
    (payload) => { delete payload.pre.tired; },
    (payload) => { payload.pre.tight = 0; },
    (payload) => { payload.pre.tight = 8; },
    (payload) => { payload.pre.tight = 3.5; },
    (payload) => { payload.pre.tight = '3'; },
    (payload) => { payload.pre.extra = 3; },
    (payload) => { payload.pre = null; }
  ];
  for (const mutate of cases) {
    const payload = samplePayload();
    mutate(payload);
    await expectError(baseUrl, await postScroll(baseUrl, payload), 400, 'invalid_pre');
  }
});

test('post 校验：缺字段 / 越界 / 未知键 → invalid_post', async (t) => {
  const baseUrl = await app(t);
  const cases = [
    (payload) => { delete payload.post.scattered; },
    (payload) => { payload.post.scattered = 0; },
    (payload) => { payload.post.scattered = 9; },
    (payload) => { payload.post.unknown = 1; }
  ];
  for (const mutate of cases) {
    const payload = samplePayload();
    mutate(payload);
    await expectError(baseUrl, await postScroll(baseUrl, payload), 400, 'invalid_post');
  }
});

test('mood 校验：非法 / 缺失 / 两处不一致', async (t) => {
  const baseUrl = await app(t);
  const invalid = samplePayload();
  invalid.mood = 'unknown-mood';
  invalid.post.mood = 'unknown-mood';
  await expectError(baseUrl, await postScroll(baseUrl, invalid), 400, 'invalid_mood');

  const missing = samplePayload();
  delete missing.mood;
  delete missing.post.mood;
  await expectError(baseUrl, await postScroll(baseUrl, missing), 400, 'missing_mood');

  const otherMood = CONTENT.post.moods[1]?.key ?? 'loose';
  const conflict = samplePayload();
  conflict.post.mood = otherMood;
  await expectError(baseUrl, await postScroll(baseUrl, conflict), 400, 'mood_conflict');
});

test('ink 校验：负数 / 超上限 / 非整数 / 缺失', async (t) => {
  const baseUrl = await app(t);
  const cases = [
    (payload) => { payload.ink.strokes = -1; },
    (payload) => { payload.ink.strokes = 100001; },
    (payload) => { payload.ink.ms = 1.5; },
    (payload) => { delete payload.ink.ms; },
    (payload) => { payload.ink = 'nope'; }
  ];
  for (const mutate of cases) {
    const payload = samplePayload();
    mutate(payload);
    await expectError(baseUrl, await postScroll(baseUrl, payload), 400, 'invalid_ink');
  }
});

test('image 校验：缺失 / 非 data URL / 非法 base64 / magic 不符', async (t) => {
  const baseUrl = await app(t);
  const missing = samplePayload();
  delete missing.image;
  await expectError(baseUrl, await postScroll(baseUrl, missing), 400, 'image_required');
  await expectError(baseUrl, await postScroll(baseUrl, samplePayload({ image: 'https://example.com/a.webp' })), 400, 'invalid_image');
  await expectError(baseUrl, await postScroll(baseUrl, samplePayload({ image: 'data:image/webp;base64,!!!!' })), 400, 'invalid_image');

  // 声明 webp 但内容是 PNG magic
  const wrongMagic = samplePayload({ image: dataUrlFor('webp', makePngBytes(256)) });
  await expectError(baseUrl, await postScroll(baseUrl, wrongMagic), 400, 'invalid_image_magic');
  // 声明 png 但内容是 RIFF/WEBP
  const wrongMagic2 = samplePayload({ image: dataUrlFor('png', makeWebpBytes(256)) });
  await expectError(baseUrl, await postScroll(baseUrl, wrongMagic2), 400, 'invalid_image_magic');
});

test('图片解码后 > 2.5MB → 413 image_too_large', async (t) => {
  const baseUrl = await app(t);
  const oversized = makeWebpBytes(2_621_441);
  const payload = samplePayload({ image: dataUrlFor('webp', oversized) });
  await expectError(baseUrl, await postScroll(baseUrl, payload), 413, 'image_too_large');
});

test('请求体 > 4MB → 413 payload_too_large', async (t) => {
  const baseUrl = await app(t);
  const payload = samplePayload();
  const body = JSON.stringify({ ...payload, padding: 'x'.repeat(4 * 1024 * 1024) });
  await expectError(baseUrl, await postScroll(baseUrl, payload, { body }), 413, 'payload_too_large');
});

test('合法 PNG 也能保存（URL 扩展名跟随实际类型 .png）', async (t) => {
  const baseUrl = await app(t);
  const result = await postScroll(baseUrl, samplePayload({ image: dataUrlFor('png', makePngBytes(512)) }));
  assert.equal(result.status, 201);
  const body = await result.json();
  assert.match(body.imageUrl, /\/image\.png$/);
  const imageResponse = await fetch(`${baseUrl}${body.imageUrl}`);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get('content-type'), 'image/png');
  // 单一语义：png 记录请求 .webp 路由 → 404
  const wrongExt = await fetch(`${baseUrl}/api/scrolls/${body.id}/image.webp`);
  assert.equal(wrongExt.status, 404);
});

test('合法 WebP 保存后 URL 恒为 /image.webp；请求 .png 路由 → 404', async (t) => {
  const baseUrl = await app(t);
  const result = await postScroll(baseUrl, samplePayload());
  assert.equal(result.status, 201);
  const body = await result.json();
  assert.match(body.imageUrl, /\/image\.webp$/);
  assert.equal((await fetch(`${baseUrl}/api/scrolls/${body.id}/image.png`)).status, 404);
});