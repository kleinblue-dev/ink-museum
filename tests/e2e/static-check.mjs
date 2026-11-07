// 墨馆 ink-museum · 静态验收（不依赖 E2E 全流程）：资产预算 / 文档齐全 / standalone 体积
// 用法：node tests/e2e/static-check.mjs   产物：_qa-artifacts/final-static/static-check.json

import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import {
  PROJECT_ROOT,
  allowedOriginsFor,
  createCollector,
  launchBrowser,
  nowIso,
  rel,
  sleep,
  spawnQaServer,
} from './harness.mjs';

const OUT_DIR = path.join(PROJECT_ROOT, '_qa-artifacts', 'final-static');
const BASE_URL = 'http://127.0.0.1:8794';

async function treeSize(dir) {
  let total = 0;
  let count = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let items;
    try { items = await readdir(current, { withFileTypes: true }); } catch { continue; }
    for (const item of items) {
      if (item.name === 'node_modules' || item.name === '.git') continue;
      const full = path.join(current, item.name);
      if (item.isDirectory()) stack.push(full);
      else {
        try { total += (await stat(full)).size; count += 1; } catch { /* ignore */ }
      }
    }
  }
  return { dir: rel(dir), bytes: total, files: count };
}

async function docsCheck() {
  const required = ['README.md', 'docs/SPEC.md', 'docs/API.md', 'docs/REA_MUSEUM.md', 'CREDITS.md', 'docs/QA_REPORT.md'];
  const result = {};
  for (const relPath of required) {
    const abs = path.join(PROJECT_ROOT, relPath);
    try {
      const info = await stat(abs);
      result[relPath] = { exists: true, bytes: info.size };
    } catch {
      result[relPath] = { exists: false, bytes: 0 };
    }
  }
  return result;
}

async function measureFirstScreen() {
  const handle = await launchBrowser({ headless: true });
  const browser = handle.browser;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', colorScheme: 'light' });
  const page = await context.newPage();
  const collector = createCollector(page, { allowedOrigins: allowedOriginsFor(BASE_URL) });
  let loading = true;
  const sizes = new Map();
  page.on('response', (res) => {
    if (!loading) return;
    const url = res.url();
    if (!url.startsWith(BASE_URL)) return;
    res.body().then((buf) => { sizes.set(url, buf.length); }).catch(() => {});
  });
  let status = null;
  try {
    const response = await page.goto(BASE_URL + '/?fresh=1', { waitUntil: 'load', timeout: 30000 });
    status = response ? response.status() : null;
    loading = false;
    await page.waitForSelector('body[data-step="enter"]', { timeout: 10000 }).catch(() => {});
    await sleep(1800);
  } finally {
    await context.close();
    await browser.close();
  }
  const resources = [...sizes.entries()].map(([url, bytes]) => ({ url, bytes })).sort((a, b) => b.bytes - a.bytes);
  const total = resources.reduce((acc, item) => acc + item.bytes, 0);
  return {
    status,
    baseURL: BASE_URL,
    resources,
    totalBytes: total,
    consoleErrors: collector.events.console.filter((m) => m.type === 'error').map((m) => m.text),
    externalRequests: collector.events.externalRequests.map((r) => r.url),
    requestFailures: collector.events.requestFailures.map((r) => ({ url: r.url, error: r.errorText })),
  };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const assets = await treeSize(path.join(PROJECT_ROOT, 'assets'));
  const images = {
    bg: await treeSize(path.join(PROJECT_ROOT, 'assets', 'bg')),
    icons: await treeSize(path.join(PROJECT_ROOT, 'assets', 'icons')),
    paper: await treeSize(path.join(PROJECT_ROOT, 'assets', 'paper-tile.webp')),
  };
  const runtimeDirs = [];
  for (const dir of ['js', 'css', 'content', 'data', 'assets']) runtimeDirs.push(await treeSize(path.join(PROJECT_ROOT, dir)));
  let runtimeFilesBytes = 0;
  let runtimeFilesCount = 0;
  for (const name of ['index.html', 'manifest.webmanifest', 'robots.txt']) {
    try { const info = await stat(path.join(PROJECT_ROOT, name)); runtimeFilesBytes += info.size; runtimeFilesCount += 1; } catch { /* ignore */ }
  }
  const siteTotal = runtimeDirs.reduce((acc, item) => acc + item.bytes, 0) + runtimeFilesBytes;
  const siteFiles = runtimeDirs.reduce((acc, item) => acc + item.files, 0) + runtimeFilesCount;

  const docs = await docsCheck();
  let standalone = { exists: false, bytes: 0 };
  try { const info = await stat(path.join(PROJECT_ROOT, 'dist', 'standalone.html')); standalone = { exists: true, bytes: info.size, builtAt: info.mtime.toISOString() }; } catch { /* ignore */ }
  let buildLog = '';
  try { buildLog = await readFile(path.join(OUT_DIR, 'build-standalone.log'), 'utf8'); } catch { /* ignore */ }

  const server = await spawnQaServer({ baseURL: BASE_URL, entryRel: 'scripts/serve-static.mjs', serverLogPath: path.join(OUT_DIR, 'static-server.log') });
  let firstScreen = null;
  try {
    firstScreen = await measureFirstScreen();
  } finally {
    await server.stop();
  }

  const result = {
    kind: 'ink-museum-static-acceptance',
    capturedAt: nowIso(),
    budgets: {
      assets,
      images,
      siteTotal: { bytes: siteTotal, files: siteFiles },
      firstScreen: firstScreen ? { totalBytes: firstScreen.totalBytes, resources: firstScreen.resources, httpStatus: firstScreen.status } : null,
      thresholds: { firstScreen: 600 * 1024, siteTotal: 6 * 1024 * 1024, images: 6 * 1024 * 1024 },
    },
    docs,
    standalone: { ...standalone, buildLog },
    firstScreenDiagnostics: firstScreen ? {
      consoleErrors: firstScreen.consoleErrors,
      externalRequests: firstScreen.externalRequests,
      requestFailures: firstScreen.requestFailures,
    } : null,
  };
  const jsonPath = path.join(OUT_DIR, 'static-check.json');
  await writeFile(jsonPath, JSON.stringify(result, null, 2), 'utf8');
  console.log('[static] firstScreen=' + (firstScreen ? firstScreen.totalBytes : 'n/a') + ' bytes (' + (firstScreen ? (firstScreen.totalBytes / 1024).toFixed(1) : '?') + 'KB)');
  console.log('[static] assets=' + assets.bytes + ' bytes (' + (assets.bytes / 1024 / 1024).toFixed(2) + 'MB), files=' + assets.files);
  console.log('[static] images(bg+icons+paper)=' + (images.bg.bytes + images.icons.bytes + images.paper.bytes) + ' bytes');
  console.log('[static] siteTotal=' + siteTotal + ' bytes (' + (siteTotal / 1024 / 1024).toFixed(2) + 'MB), files=' + siteFiles);
  console.log('[static] standalone=' + (standalone.exists ? standalone.bytes + ' bytes (' + (standalone.bytes / 1024 / 1024).toFixed(2) + 'MB)' : 'missing'));
  console.log('[static] docs=' + JSON.stringify(Object.fromEntries(Object.entries(docs).map(([k, v]) => [k, v.exists]))));
  console.log('[static] JSON: ' + rel(jsonPath));
}

main().catch((err) => {
  console.error('[static] 失败：' + String(err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
