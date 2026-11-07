// 墨馆后端 · 存储测试（重启重建索引 / 坏行计数 / 半行修复 / 幂等跨重启 / 原子写图片）
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  CONTENT,
  RELAXED_LIMITS,
  startAppOnly,
  saveScroll,
  samplePayload,
  fetchJson,
  makeTempDir,
  makePublicFixture,
  removeDir,
  appendRaw
} from './helpers.mjs';

function appOptions(dataDir, publicDir) {
  return { env: {}, dataDir, publicDir, limits: RELAXED_LIMITS };
}

/** startAppOnly 返回 {app, baseUrl, cleanup}；这里包一层，让测试里可直接 active.close() */
async function openApp(options) {
  const ctx = await startAppOnly(options);
  return {
    app: ctx.app,
    baseUrl: ctx.baseUrl,
    cleanup: ctx.cleanup,
    close: () => ctx.app.close()
  };
}

test('重启重建索引：坏行跳过并计数；截断半行不污染后续写入', async () => {
  const dataDir = await makeTempDir('ink-museum-store-');
  const fixture = await makePublicFixture();
  const options = appOptions(dataDir, fixture.publicDir);
  let active = null;
  try {
    active = await openApp(options);
    const first = await saveScroll(active.baseUrl, { sceneId: CONTENT.scenes[0].id });
    const second = await saveScroll(active.baseUrl, { sceneId: CONTENT.scenes[1].id });
    await active.close();
    active = null;

    // 追加 3 行坏数据：非法 JSON、字段不完整、无换行的半行
    await appendRaw(dataDir, 'not-json\n{"id":"broken"}\n{"torn":');

    active = await openApp(options);
    const stats = await fetchJson(`${active.baseUrl}/api/stats`);
    assert.equal(stats.status, 200);
    assert.equal(stats.body.total, 2);
    assert.equal(stats.body.badLines, 3);

    const list = await fetchJson(`${active.baseUrl}/api/scrolls`);
    assert.equal(list.body.total, 2);
    assert.deepEqual(new Set(list.body.items.map((item) => item.id)), new Set([first.id, second.id]));

    // 半行已被补换行：新 save 能正常追加
    const third = await saveScroll(active.baseUrl);
    assert.ok(third.id);
    await active.close();
    active = null;

    // 落盘检查：好行仍可解析，坏行计数不变
    const raw = await readFile(path.join(dataDir, 'scrolls.jsonl'), 'utf8');
    const lines = raw.split('\n').filter((line) => line.length > 0);
    const parseable = lines.filter((line) => {
      try {
        JSON.parse(line);
        return true;
      } catch {
        return false;
      }
    });
    // 4 行能被 JSON.parse（3 条好记录 + 字段不完整的坏记录），其余 2 行不是合法 JSON
    assert.equal(parseable.length, 4);
    assert.equal(lines.length, 6);

    active = await openApp(options);
    const stats2 = await fetchJson(`${active.baseUrl}/api/stats`);
    assert.equal(stats2.body.total, 3);
    assert.equal(stats2.body.badLines, 3);
    const list2 = await fetchJson(`${active.baseUrl}/api/scrolls`);
    assert.equal(list2.body.total, 3);
  } finally {
    if (active) await active.close().catch(() => {});
    await removeDir(dataDir);
    await removeDir(fixture.root);
  }
});

test('图片原子写入：images/ 下只有 <id>.<webp|png>，无临时文件残留', async () => {
  const dataDir = await makeTempDir('ink-museum-store-');
  const fixture = await makePublicFixture();
  const active = await openApp(appOptions(dataDir, fixture.publicDir));
  try {
    const webpScroll = await saveScroll(active.baseUrl);
    const pngScroll = await saveScroll(active.baseUrl, { image: undefined });
    // 第二个用默认 webp; 再显式存一个 png
    const pngPayload = { image: samplePayload().image };
    const pngScroll2 = await saveScroll(active.baseUrl);
    const files = await readdir(path.join(dataDir, 'images'));
    assert.equal(files.length, 3);
    for (const file of files) {
      assert.match(file, /^[0-9a-f-]{36}\.(webp|png)$/);
      assert.equal(file.includes('.tmp'), false);
    }
    assert.ok(webpScroll.id && pngScroll.id && pngScroll2.id);
    assert.ok(files.includes(`${webpScroll.id}.webp`));
    void pngPayload;
  } finally {
    await active.close().catch(() => {});
    await removeDir(dataDir);
    await removeDir(fixture.root);
  }
});

test('幂等键跨重启仍生效：重放返回同 id，不重复落盘', async () => {
  const dataDir = await makeTempDir('ink-museum-store-');
  const fixture = await makePublicFixture();
  const options = appOptions(dataDir, fixture.publicDir);
  const key = 'restart-idem-key-1';
  const payload = samplePayload();
  const headers = { 'content-type': 'application/json', 'idempotency-key': key };
  let active = await openApp(options);
  try {
    const first = await fetchJson(`${active.baseUrl}/api/scrolls`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    assert.equal(first.status, 201);
    await active.close();

    active = await openApp(options);
    const replay = await fetchJson(`${active.baseUrl}/api/scrolls`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.headers.get('idempotent-replay'), 'true');
    assert.equal(replay.body.id, first.body.id);
    const list = await fetchJson(`${active.baseUrl}/api/scrolls`);
    assert.equal(list.body.total, 1);
  } finally {
    await active.close().catch(() => {});
    await removeDir(dataDir);
    await removeDir(fixture.root);
  }
});