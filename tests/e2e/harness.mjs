// 墨馆 ink-museum · E2E 基础设施 harness
// 职责：dev server 托管/复用、系统 Chrome 启动、console/pageerror/网络采集、视口截图、项目快照、结果写出。
// 依赖：Node 内置模块 + playwright-core（--no-save 安装；用系统 Chrome，不下载 Playwright 浏览器）。
// 退出码约定（由 run.mjs 决定）：0 全过 / 1 有失败 / 2 基建不可用。

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
export const ARTIFACTS_ROOT = path.join(PROJECT_ROOT, '_qa-artifacts');
export const DEFAULT_BASE_URL = 'http://127.0.0.1:8790';
export const DEFAULT_TIMEOUT_MS = 30000;

export const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
].filter(Boolean);

export const VIEWPORTS = Object.freeze([
  Object.freeze({ name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 }),
  Object.freeze({ name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }),
  Object.freeze({ name: 'narrow', width: 320, height: 640, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }),
]);

export class InfraError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InfraError';
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function nowIso() { return new Date().toISOString(); }
export function log(...args) { console.log('[qa]', ...args); }
export function rel(absPath) { return path.relative(PROJECT_ROOT, absPath).split(path.sep).join('/'); }

function isInside(parent, child) {
  const r = path.relative(parent, child);
  return !!r && !r.startsWith('..') && !path.isAbsolute(r);
}

// ---------------------------------------------------------------------------
// HTTP 探测 / dev server 管理
// ---------------------------------------------------------------------------

export async function httpProbe(url, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'manual' });
    return { ok: true, status: res.status, location: res.headers.get('location') || null };
  } catch (err) {
    const code = err?.cause?.code || err?.code || err?.name || 'unknown';
    return { ok: false, status: null, error: String(code) + ' ' + String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForHttp(baseURL, { timeoutMs = 25000, intervalMs = 250 } = {}) {
  const started = Date.now();
  let lastError = null;
  let lastStatus = null;
  while (Date.now() - started < timeoutMs) {
    const r = await httpProbe(baseURL.replace(/\/+$/, '') + '/', 2000);
    if (r.ok) return { ok: true, status: r.status, waitedMs: Date.now() - started };
    lastError = r.error;
    lastStatus = r.status;
    await sleep(intervalMs);
  }
  return { ok: false, lastError, lastStatus, waitedMs: Date.now() - started };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

// 兜底静态服务器：仅当 server/index.mjs 还不存在时使用（早期阶段），只托管项目根文件，不提供 /api。
async function startFallbackStatic(baseURL) {
  const parsed = new URL(baseURL);
  const port = Number(parsed.port || 80);
  const host = parsed.hostname || '127.0.0.1';
  const server = createServer(async (req, res) => {
    try {
      const u = new URL(req.url || '/', 'http://' + host + ':' + port);
      let pathname = decodeURIComponent(u.pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      let filePath = path.resolve(PROJECT_ROOT, '.' + pathname);
      if (!isInside(PROJECT_ROOT, filePath)) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('403 Forbidden');
        return;
      }
      let st;
      try { st = await stat(filePath); } catch { st = null; }
      if (st && st.isDirectory()) filePath = path.join(filePath, 'index.html');
      const body = await readFile(filePath).catch(() => null);
      if (body === null) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        res.end('404 Not Found (harness fallback static: no ' + pathname + ')');
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'content-length': body.length,
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('500 ' + String(err && err.message));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  return server;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  try { child.kill(); } catch { /* ignore */ }
  const deadline = Date.now() + 4000;
  while (child.exitCode === null && Date.now() < deadline) await sleep(100);
  if (child.exitCode === null && child.pid) {
    if (process.platform === 'win32') {
      try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { /* ignore */ }
      await sleep(300);
    } else {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }
  }
}

// 优先级：复用已有服务 -> spawn node server/index.mjs（后端）-> spawn scripts/serve-static.mjs（项目自带 local 静态）-> harness 兜底静态。
export async function ensureServer({ baseURL = DEFAULT_BASE_URL, timeoutMs = 30000, serverLogPath = null } = {}) {
  const normalizedBase = baseURL.replace(/\/+$/, '');
  const warnings = [];
  const probe = await httpProbe(normalizedBase + '/', 2500);
  if (probe.ok) {
    return {
      mode: 'reuse',
      baseURL: normalizedBase,
      startedByUs: false,
      pid: null,
      warnings,
      probe,
      serverLogRel: null,
      stop: async () => {},
    };
  }

  const backendEntry = path.join(PROJECT_ROOT, 'server', 'index.mjs');
  const staticEntry = path.join(PROJECT_ROOT, 'scripts', 'serve-static.mjs');
  let entry = null;
  let mode = null;
  if (existsSync(backendEntry)) {
    entry = backendEntry;
    mode = 'spawned';
  } else if (existsSync(staticEntry)) {
    entry = staticEntry;
    mode = 'spawned-static';
    warnings.push('server/index.mjs 不存在（后端未就绪）：使用项目自带 scripts/serve-static.mjs 托管前台（local 模式，无 /api），页面状态按真实情况记录。');
  } else {
    warnings.push('server/index.mjs 与 scripts/serve-static.mjs 都不存在：harness 兜底静态服务器托管项目根，/api/* 不可用，结果按真实 404/空壳记录。');
    const server = await startFallbackStatic(normalizedBase);
    if (serverLogPath) {
      try {
        await mkdir(path.dirname(serverLogPath), { recursive: true });
        await writeFile(serverLogPath, '[harness] fallback static server（无 server/index.mjs 也无 scripts/serve-static.mjs）\n', 'utf8');
      } catch { /* ignore */ }
    }
    return {
      mode: 'fallback-static',
      baseURL: normalizedBase,
      startedByUs: true,
      pid: null,
      warnings,
      probe,
      serverLogRel: serverLogPath ? rel(serverLogPath) : null,
      stop: () => new Promise((resolve) => server.close(() => resolve())),
    };
  }

  let logStream = null;
  if (serverLogPath) {
    try {
      await mkdir(path.dirname(serverLogPath), { recursive: true });
      logStream = createWriteStream(serverLogPath, { flags: 'w' });
    } catch { logStream = null; }
  }
  const parsed = new URL(normalizedBase);
  const child = spawn(process.execPath, [entry], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PORT: String(parsed.port || 8790), HOST: parsed.hostname || '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let tail = '';
  const onData = (chunk) => {
    const s = String(chunk);
    tail = (tail + s).slice(-6000);
    if (logStream) logStream.write(s);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  const ready = await waitForHttp(normalizedBase, { timeoutMs, intervalMs: 250 });
  if (!ready.ok) {
    await stopChild(child);
    if (logStream) logStream.end();
    throw new InfraError('dev server 启动失败（node ' + path.relative(PROJECT_ROOT, entry) + '）：' + (ready.lastError || '超时') + '；服务输出：\n' + tail.slice(-1500));
  }
  const entryRel = path.relative(PROJECT_ROOT, entry).split(path.sep).join('/');
  warnings.push(entryRel + ' 由 harness 自动启动（PID ' + child.pid + '），运行结束会按 PID 关闭。');
  return {
    mode,
    baseURL: normalizedBase,
    startedByUs: true,
    pid: child.pid,
    warnings,
    serverLogRel: serverLogPath ? rel(serverLogPath) : null,
    outputTail: () => tail,
    stop: async () => {
      await stopChild(child);
      if (logStream) logStream.end();
    },
  };
}
// ---------------------------------------------------------------------------
// Chrome / playwright-core
// ---------------------------------------------------------------------------

export async function readInstalledVersion(pkg) {
  try {
    const p = path.join(PROJECT_ROOT, 'node_modules', pkg, 'package.json');
    const parsed = JSON.parse(await readFile(p, 'utf8'));
    return parsed.version || null;
  } catch {
    return null;
  }
}

export function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try { if (candidate && existsSync(candidate)) return candidate; } catch { /* ignore */ }
  }
  throw new InfraError('未找到系统 Chrome（可设环境变量 CHROME_PATH 指定 chrome.exe）');
}

export async function launchBrowser({ headless = true } = {}) {
  let playwright;
  try {
    playwright = await import('playwright-core');
  } catch (err) {
    throw new InfraError('playwright-core 不可用：请在 ink-museum 下执行 npm install --no-save playwright-core（不要 npx playwright install 下载浏览器）。原始错误：' + String(err && err.message ? err.message : err));
  }
  const executablePath = findChrome();
  let browser;
  try {
    browser = await playwright.chromium.launch({
      executablePath,
      headless,
      args: ['--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'],
    });
  } catch (err) {
    throw new InfraError('系统 Chrome 启动失败（' + executablePath + '）：' + String(err && err.message ? err.message : err));
  }
  return {
    browser,
    executablePath,
    version: browser.version(),
    playwrightVersion: await readInstalledVersion('playwright-core'),
  };
}

// ---------------------------------------------------------------------------
// 采集器：console / pageerror / 请求（含外站判定）/ 失败响应
// ---------------------------------------------------------------------------

export function allowedOriginsFor(baseURL) {
  const u = new URL(baseURL);
  const origins = new Set([u.origin]);
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  if (u.hostname === '127.0.0.1') origins.add('http://localhost:' + port);
  if (u.hostname === 'localhost') origins.add('http://127.0.0.1:' + port);
  return [...origins];
}

const NON_HTTP_PROTOCOLS = new Set(['data:', 'blob:', 'about:', 'chrome:', 'chrome-extension:', 'devtools:', 'filesystem:']);

export function createCollector(page, { allowedOrigins = [] } = {}) {
  const allowed = new Set(allowedOrigins);
  const events = { console: [], pageErrors: [], requests: [], externalRequests: [], requestFailures: [], failedResponses: [] };

  page.on('console', (msg) => {
    const loc = msg.location() || {};
    events.console.push({
      type: msg.type(),
      text: msg.text(),
      url: loc.url || '',
      lineNumber: Number.isFinite(loc.lineNumber) ? loc.lineNumber : null,
      columnNumber: Number.isFinite(loc.columnNumber) ? loc.columnNumber : null,
    });
  });
  page.on('pageerror', (error) => {
    events.pageErrors.push({
      message: error && error.message ? error.message : String(error),
      stack: String(error && error.stack ? error.stack : '').split('\n').slice(0, 8).join('\n'),
    });
  });
  page.on('request', (request) => {
    const url = request.url();
    let parsed;
    try { parsed = new URL(url); } catch { return; }
    if (NON_HTTP_PROTOCOLS.has(parsed.protocol)) return;
    const entry = {
      url,
      method: request.method(),
      resourceType: request.resourceType(),
      origin: parsed.origin,
      protocol: parsed.protocol,
    };
    events.requests.push(entry);
    const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    if (isHttp && !allowed.has(parsed.origin)) events.externalRequests.push(entry);
  });
  page.on('requestfailed', (request) => {
    events.requestFailures.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      errorText: request.failure() ? request.failure().errorText : 'unknown',
    });
  });
  page.on('response', (response) => {
    const status = response.status();
    if (status >= 400) {
      events.failedResponses.push({
        url: response.url(),
        status,
        resourceType: response.request() ? response.request().resourceType() : '',
        fromServiceWorker: typeof response.fromServiceWorker === 'function' ? response.fromServiceWorker() : false,
      });
    }
  });

  return {
    events,
    get consoleErrors() { return events.console.filter((m) => m.type === 'error'); },
    get consoleWarnings() { return events.console.filter((m) => m.type === 'warning'); },
    get pageErrors() { return events.pageErrors.slice(); },
    get externalRequests() { return events.externalRequests.slice(); },
    get requestFailures() { return events.requestFailures.slice(); },
    get failedResponses() { return events.failedResponses.slice(); },
  };
}

// ---------------------------------------------------------------------------
// 单视口采集：导航 -> 采样 -> 截图 -> HTML 快照
// ---------------------------------------------------------------------------

const PAGE_INFO_FN = () => {
  const body = document.body;
  const text = body ? String(body.innerText || '').replace(/\s+/g, ' ').trim() : '';
  let localStorageKeys = [];
  try { localStorageKeys = Object.keys(localStorage); } catch { /* ignore */ }
  return {
    title: document.title || '',
    url: location.href,
    readyState: document.readyState,
    bodyText: text.slice(0, 600),
    bodyTextLength: text.length,
    elementCount: document.querySelectorAll('*').length,
    canvasCount: document.querySelectorAll('canvas').length,
    imgCount: document.querySelectorAll('img').length,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    localStorageKeys,
    prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
};

export async function captureViewport(browser, opts) {
  const {
    baseURL,
    targetPath = '/',
    viewport,
    outDir,
    label,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    settleMs = 500,
    fullPage = false,
    reducedMotion = 'no-preference',
  } = opts;

  const startedAt = nowIso();
  const requestedUrl = new URL(targetPath, baseURL).href;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: !!viewport.isMobile,
    hasTouch: !!viewport.hasTouch,
    deviceScaleFactor: viewport.deviceScaleFactor || 1,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
    reducedMotion,
  });
  const page = await context.newPage();
  const collector = createCollector(page, { allowedOrigins: allowedOriginsFor(baseURL) });
  const cap = {
    viewport: {
      name: viewport.name,
      width: viewport.width,
      height: viewport.height,
      isMobile: !!viewport.isMobile,
      hasTouch: !!viewport.hasTouch,
      deviceScaleFactor: viewport.deviceScaleFactor || 1,
      reducedMotion,
    },
    label,
    requestedUrl,
    finalUrl: null,
    navStatus: null,
    navError: null,
    networkIdleTimeout: false,
    evalError: null,
    pageInfo: null,
    screenshot: null,
    screenshotError: null,
    htmlSnapshot: null,
    console: [],
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    failedResponses: [],
    externalRequests: [],
    requestCount: 0,
    startedAt,
    finishedAt: null,
  };

  try {
    try {
      const response = await page.goto(requestedUrl, { waitUntil: 'load', timeout: timeoutMs });
      if (response) {
        cap.navStatus = response.status();
        cap.finalUrl = response.url();
      }
    } catch (err) {
      cap.navError = String(err && err.message ? err.message : err);
    }

    if (!cap.navError) {
      try { await page.waitForLoadState('networkidle', { timeout: 4000 }); } catch { cap.networkIdleTimeout = true; }
      await page.waitForTimeout(settleMs);
    }
    try { cap.pageInfo = await page.evaluate(PAGE_INFO_FN); } catch (err) { cap.evalError = String(err && err.message ? err.message : err); }

    const shotName = label + '-' + viewport.width + 'x' + viewport.height + '.png';
    const shotPath = path.join(outDir, shotName);
    try {
      await page.screenshot({ path: shotPath, fullPage });
      cap.screenshot = rel(shotPath);
    } catch (err) {
      cap.screenshotError = String(err && err.message ? err.message : err);
    }

    const htmlName = label + '-' + viewport.width + 'x' + viewport.height + '.html';
    const htmlPath = path.join(outDir, htmlName);
    try {
      await writeFile(htmlPath, await page.content(), 'utf8');
      cap.htmlSnapshot = rel(htmlPath);
    } catch (err) {
      cap.htmlSnapshotError = String(err && err.message ? err.message : err);
    }
  } finally {
    cap.console = collector.events.console.slice();
    cap.consoleErrors = collector.consoleErrors;
    cap.pageErrors = collector.pageErrors;
    cap.requestFailures = collector.requestFailures;
    cap.failedResponses = collector.failedResponses;
    cap.externalRequests = collector.externalRequests;
    cap.requestCount = collector.events.requests.length;
    cap.finishedAt = nowIso();
    try { await context.close(); } catch { /* ignore */ }
  }
  return cap;
}

// ---------------------------------------------------------------------------
// 项目快照（证据：本次跑的是哪一版代码）
// ---------------------------------------------------------------------------

const SNAPSHOT_PATHS = [
  'index.html',
  'package.json',
  'content/content.js',
  'data/masks.json',
  'css',
  'js',
  'js/ink/engine.js',
  'server',
  'server/index.mjs',
  'assets',
  'scripts',
  'tests',
  'docs',
  'manifest.webmanifest',
  'robots.txt',
  'dist/standalone.html',
];

async function countFiles(dir) {
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
      else count += 1;
    }
  }
  return count;
}

export async function snapshotProject() {
  const out = { capturedAt: nowIso(), entries: {} };
  for (const relPath of SNAPSHOT_PATHS) {
    const abs = path.join(PROJECT_ROOT, relPath);
    try {
      const st = await stat(abs);
      if (st.isDirectory()) {
        out.entries[relPath] = { type: 'dir', fileCount: await countFiles(abs) };
      } else {
        const buf = await readFile(abs);
        out.entries[relPath] = {
          type: 'file',
          size: st.size,
          mtime: st.mtime.toISOString(),
          sha256_16: createHash('sha256').update(buf).digest('hex').slice(0, 16),
        };
      }
    } catch {
      out.entries[relPath] = { type: 'missing' };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 产物目录
// ---------------------------------------------------------------------------

export async function prepareOutDir(dir, { clean = true } = {}) {
  const resolved = path.resolve(dir);
  if (!isInside(PROJECT_ROOT, resolved)) throw new InfraError('产物目录必须在项目内：' + resolved);
  const insideArtifacts = isInside(ARTIFACTS_ROOT, resolved);
  if (clean && insideArtifacts) await rm(resolved, { recursive: true, force: true });
  await mkdir(resolved, { recursive: true });
  return { outDir: resolved, cleaned: clean && insideArtifacts, rel: rel(resolved) };
}
