// 墨馆后端 · 静态托管测试（MIME / 缓存 / CSP / 404 / 路径穿越 / no-static）
import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, fetchJson } from './helpers.mjs';
import { CSP_POLICY } from '../security.mjs';

async function app(t, overrides = {}) {
  const ctx = await startTestApp(t, { env: {}, ...overrides });
  return ctx.baseUrl;
}

test('GET / 托管 index.html：text/html + no-cache + 全套安全头', async (t) => {
  const baseUrl = await app(t);
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-cache');
  assert.equal(response.headers.get('content-security-policy'), CSP_POLICY);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('permissions-policy'), /camera=\(\)/);
  const html = await response.text();
  assert.match(html, /墨馆测试首页/);
});

test('静态资源 MIME 正确、缓存 1 小时、nosniff', async (t) => {
  const baseUrl = await app(t);
  const cases = [
    ['/css/app.css', 'text/css; charset=utf-8'],
    ['/js/app.js', 'text/javascript; charset=utf-8'],
    ['/js/app.mjs', 'text/javascript; charset=utf-8'],
    ['/data/masks.json', 'application/json; charset=utf-8'],
    ['/assets/bg/spring-wide.webp', 'image/webp'],
    ['/assets/icons/icon-192.png', 'image/png'],
    ['/assets/icons/icon.svg', 'image/svg+xml'],
    ['/manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
    ['/robots.txt', 'text/plain; charset=utf-8'],
    ['/assets/icons/favicon.ico', 'image/x-icon'],
    ['/README.md', 'text/markdown; charset=utf-8']
  ];
  for (const [pathname, mime] of cases) {
    const response = await fetch(`${baseUrl}${pathname}`);
    assert.equal(response.status, 200, pathname);
    assert.equal(response.headers.get('content-type'), mime, pathname);
    assert.match(response.headers.get('cache-control'), /max-age=3600/, pathname);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', pathname);
    assert.equal(response.headers.get('content-security-policy'), CSP_POLICY, pathname);
  }
});

test('目录路径回落到 index.html；HEAD 只发头不发 body', async (t) => {
  const baseUrl = await app(t);
  const nested = await fetch(`${baseUrl}/nested/deep/`);
  assert.equal(nested.status, 200);
  assert.equal(nested.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.match(await nested.text(), /deep/);

  const head = await fetch(`${baseUrl}/css/app.css`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'text/css; charset=utf-8');
  assert.ok(Number(head.headers.get('content-length')) > 0);
  assert.equal(await head.text(), '');
});

test('404 返回干净 HTML 页面（带安全头，不泄漏目录信息）', async (t) => {
  const baseUrl = await app(t);
  const response = await fetch(`${baseUrl}/missing-page.html`);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-cache');
  assert.equal(response.headers.get('content-security-policy'), CSP_POLICY);
  const html = await response.text();
  assert.match(html, /404/);
  assert.equal(html.includes('TOP-SECRET-OUTSIDE-PUBLIC'), false);
});

test('路径穿越被拒绝：编码 ..%2f / ..%5c 与 NUL', async (t) => {
  const baseUrl = await app(t);
  const traversalCases = [
    '/%2e%2e%2fsecret.txt',
    '/%2E%2E%2Fsecret.txt',
    '/..%5csecret.txt',
    '/%2e%2e%5csecret.txt'
  ];
  for (const pathname of traversalCases) {
    const response = await fetch(`${baseUrl}${pathname}`);
    assert.equal(response.status, 403, `${pathname} 应被拒绝`);
    const text = await response.text();
    assert.equal(text.includes('TOP-SECRET-OUTSIDE-PUBLIC'), false, `${pathname} 不得泄漏 publicDir 外文件`);
  }

  // URL 解析器会把单独的 %2e%2e 段归一化 → 落不到真实文件上（404 亦可）
  const normalized = await fetch(`${baseUrl}/%2e%2e/%2e%2e/secret.txt`);
  assert.ok([403, 404].includes(normalized.status));
  assert.equal((await normalized.text()).includes('TOP-SECRET-OUTSIDE-PUBLIC'), false);

  const withNul = await fetch(`${baseUrl}/%00`);
  assert.equal(withNul.status, 400);

  // 正常文件仍可访问
  assert.equal((await fetch(`${baseUrl}/robots.txt`)).status, 200);
});

test('静态路径非 GET/HEAD → 405', async (t) => {
  const baseUrl = await app(t);
  const response = await fetch(`${baseUrl}/`, { method: 'POST', body: 'x' });
  assert.equal(response.status, 405);
  const body = await response.json();
  assert.equal(body.error.code, 'method_not_allowed');
});

test('--no-static：静态路径 404 JSON（static_disabled），API 正常', async (t) => {
  const baseUrl = await app(t, { noStatic: true });
  const page = await fetchJson(`${baseUrl}/`);
  assert.equal(page.status, 404);
  assert.equal(page.body.error.code, 'static_disabled');
  assert.equal((await fetchJson(`${baseUrl}/api/health`)).status, 200);
  assert.equal((await fetchJson(`${baseUrl}/api/scrolls`)).status, 200);
});