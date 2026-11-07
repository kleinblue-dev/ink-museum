// 墨馆后端 · 测试辅助（临时 DATA_DIR / PUBLIC_DIR、端口 0、合法的最小图片）
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import CONTENT from '../../content/content.js';
import { createApp } from '../app.mjs';
import { PNG_MAGIC } from '../media.mjs';

export { CONTENT };

export const RELAXED_LIMITS = Object.freeze({
  save: { max: 200, windowMs: 60 * 1000 },
  read: { max: 2000, windowMs: 60 * 1000 }
});

/** 测试用静默 logger（保留 error 便于排查真实故障） */
export const testLogger = Object.freeze({
  log() {},
  info() {},
  warn() {},
  error: (...args) => console.error(...args)
});

export async function makeTempDir(prefix = 'ink-museum-test-') {
  return await mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function removeDir(dir) {
  if (!dir) return;
  await rm(dir, { recursive: true, force: true, maxRetries: 3 });
}

export function makePngBytes(size = 128) {
  const buffer = Buffer.alloc(Math.max(size, 16), 0);
  PNG_MAGIC.copy(buffer, 0);
  return buffer;
}

export function makeWebpBytes(size = 256) {
  const buffer = Buffer.alloc(Math.max(size, 16), 0);
  buffer.write('RIFF', 0, 'latin1');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WEBP', 8, 'latin1');
  buffer.write('VP8 ', 12, 'latin1');
  return buffer;
}

export function dataUrlFor(type, buffer) {
  const mime = type === 'png' ? 'image/png' : 'image/webp';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

/** 静态托管测试夹具：PUBLIC_DIR + 一个位于 PUBLIC_DIR 之外的 secret.txt */
export async function makePublicFixture() {
  const root = await makeTempDir('ink-museum-public-');
  const publicDir = path.join(root, 'public');
  const files = {
    'index.html': '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><title>墨馆测试首页</title></head><body><main data-fixture="home">墨馆测试首页</main></body></html>\n',
    'css/app.css': ':root { color: #26221c; }\n',
    'js/app.js': 'export const answer = 42;\n',
    'js/app.mjs': 'export default 1;\n',
    'data/masks.json': JSON.stringify({ fixture: true }) + '\n',
    'assets/bg/spring-wide.webp': makeWebpBytes(64),
    'assets/icons/icon-192.png': makePngBytes(64),
    'assets/icons/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>\n',
    'assets/icons/favicon.ico': Buffer.from([0, 0, 1, 0]),
    'manifest.webmanifest': '{"name":"墨馆"}\n',
    'robots.txt': 'User-agent: *\n',
    'README.md': '# 墨馆测试\n',
    'nested/deep/index.html': '<!doctype html><title>deep</title>\n'
  };
  for (const [relative, value] of Object.entries(files)) {
    const target = path.join(publicDir, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, value);
  }
  await writeFile(path.join(root, 'secret.txt'), 'TOP-SECRET-OUTSIDE-PUBLIC');
  return { root, publicDir };
}

/** 只创建 + 监听，不注册清理（用于需要重启的场景） */
export async function startAppOnly(overrides = {}) {
  const dataDir = overrides.dataDir ?? await makeTempDir('ink-museum-data-');
  const publicFixture = overrides.publicDir ? null : await makePublicFixture();
  const publicDir = overrides.publicDir ?? publicFixture.publicDir;
  const app = await createApp({
    dataDir,
    publicDir,
    port: 0,
    host: '127.0.0.1',
    logger: testLogger,
    ...overrides
  });
  await app.listen();
  const cleanup = async () => {
    await app.close().catch(() => {});
    if (!overrides.dataDir) await removeDir(dataDir);
    if (publicFixture) await removeDir(publicFixture.root);
  };
  return { app, baseUrl: app.url, dataDir, publicDir, cleanup };
}

/** 标准测试起步：临时 DATA_DIR + 临时 PUBLIC_DIR + 端口 0，t.after 自动关闭并清理 */
export async function startTestApp(t, overrides = {}) {
  const ctx = await startAppOnly(overrides);
  if (t) {
    t.after(async () => {
      await ctx.cleanup();
    });
  }
  return ctx;
}

export function samplePayload(overrides = {}) {
  const sceneId = CONTENT.scenes?.[0]?.id ?? 'spring';
  const mood = CONTENT.post?.moods?.[0]?.key ?? 'quiet';
  return {
    schemaVersion: CONTENT.version ?? '1.0.0',
    clientId: 'im_testclient01',
    sceneId,
    pre: { tight: 3, tired: 4, scattered: 2 },
    post: { tight: 2, tired: 3, scattered: 1, mood },
    ink: { strokes: 12, stamps: 2, ms: 48000 },
    mood,
    image: dataUrlFor('webp', makeWebpBytes(256)),
    ...overrides
  };
}

/** 发 POST /api/scrolls；key 传 null 可测缺少幂等键 */
export async function postScroll(baseUrl, payload, options = {}) {
  const { key = `test-${crypto.randomUUID()}`, headers = {}, ...init } = options;
  const requestHeaders = { 'content-type': 'application/json', ...headers };
  if (key !== null && key !== undefined) requestHeaders['idempotency-key'] = key;
  return await fetch(`${baseUrl}/api/scrolls`, {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify(payload),
    ...init
  });
}

/** 保存一条并断言 201，返回响应 body */
export async function saveScroll(baseUrl, options = {}) {
  const payload = samplePayload(options.payload);
  if (options.sceneId) payload.sceneId = options.sceneId;
  if (options.mood) {
    payload.mood = options.mood;
    payload.post.mood = options.mood;
  }
  if (options.clientId) payload.clientId = options.clientId;
  if (options.image) payload.image = options.image;
  const { status, body } = await fetchJson(`${baseUrl}/api/scrolls`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': options.key ?? `save-${crypto.randomUUID()}` },
    body: JSON.stringify(payload)
  });
  if (status !== 201) throw new Error(`saveScroll 失败：${status} ${JSON.stringify(body)}`);
  return body;
}

/** fetch + 解析 JSON（解析失败时 body 为原始文本） */
export async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { response, status: response.status, headers: response.headers, body, text };
}

/** 读取 dataDir/scrolls.jsonl 并逐行解析（用于断言落盘结构） */
export async function readRecords(dataDir) {
  let text;
  try {
    text = await readFile(path.join(dataDir, 'scrolls.jsonl'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return text.split('\n').filter((line) => line.trim().length > 0).map((line) => JSON.parse(line));
}

/** 把坏行追加进 scrolls.jsonl（重建索引测试用） */
export async function appendRaw(dataDir, contents) {
  await writeFile(path.join(dataDir, 'scrolls.jsonl'), contents, { flag: 'a' });
}