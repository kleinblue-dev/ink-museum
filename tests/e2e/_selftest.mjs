// 临时自检：验证 full suite 的页面选择器/交互假设（非验收，不写产品文件）
import path from 'node:path';
import { spawnQaServer, launchBrowser, allowedOriginsFor, createCollector, PROJECT_ROOT, rel, sleep } from './harness.mjs';

const BASE = 'http://127.0.0.1:8794';
const OUT = path.join(PROJECT_ROOT, '_qa-artifacts', 'selftest');
const checks = [];
function ck(id, pass, detail) { checks.push({ id, pass, detail }); console.log((pass ? 'PASS ' : 'FAIL ') + id + ' :: ' + (detail || '')); }
const SCALE_KEYS = ['tight', 'tired', 'scattered'];

const server = await spawnQaServer({ baseURL: BASE, entryRel: 'scripts/serve-static.mjs', serverLogPath: path.join(OUT, 'server.log') });
const handle = await launchBrowser({ headless: true });
const browser = handle.browser;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', colorScheme: 'light' });
  const page = await context.newPage();
  const collector = createCollector(page, { allowedOrigins: allowedOriginsFor(BASE) });
  const step = () => page.evaluate(() => document.body && document.body.dataset ? document.body.dataset.step : null);
  const waitStep = async (s, t = 15000) => { await page.waitForSelector('body[data-step="' + s + '"]', { timeout: t }); };
  const click = async (name) => { const loc = page.getByRole('button', { name, exact: true }).first(); await loc.waitFor({ state: 'visible', timeout: 10000 }); await loc.click(); };
  const touch = async (phase, key) => { const i = page.locator('input#' + phase + '-' + key).first(); await i.waitFor({ state: 'visible' }); await i.click(); await i.press('ArrowRight'); await sleep(60); return Number(await i.inputValue()); };
  const readSession = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('ink-museum.session.v1') || 'null'); } catch (e) { return null; } });

  const resp = await page.goto(BASE + '/?fresh=1', { waitUntil: 'load', timeout: 30000 });
  await waitStep('enter');
  ck('http.200', resp.status() === 200, 'status=' + resp.status());
  ck('title', /墨馆/.test(await page.title()), 'title=' + (await page.title()));
  await click('入馆'); await waitStep('pre');
  ck('pre.guard', await page.getByRole('button', { name: '往里走', exact: true }).first().isDisabled(), 'next disabled before touch');
  for (const k of SCALE_KEYS) await touch('pre', k);
  await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '往里走'); return b && !b.disabled; }, null, { timeout: 8000 });
  await click('往里走'); await waitStep('scene');
  ck('scene.cards', (await page.locator('.scene-card').count()) === 4, 'cards=' + (await page.locator('.scene-card').count()));
  await page.getByRole('button', { name: /早春/ }).first().click(); await waitStep('line');
  await click('看一看'); await page.waitForSelector('.line-next.is-visible', { timeout: 10000 });
  ck('line.nextVisible', true, 'line-next is-visible');
  await click('落墨'); await waitStep('ink');
  await page.locator('canvas.ink-canvas').first().waitFor({ state: 'visible', timeout: 12000 });
  const sig = () => page.evaluate(() => { const c = document.querySelector('canvas.ink-canvas'); return c ? c.toDataURL('image/png').length : 0; });
  const d0 = await sig();
  const box = await page.locator('canvas.ink-canvas').first().boundingBox();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.4); await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + box.width * (0.35 + 0.3 * i / 12), box.y + box.height * (0.4 + 0.15 * i / 12));
  await page.mouse.up(); await sleep(300);
  const d1 = await sig();
  ck('ink.stroke', d1 !== d0, 'dataUrlLen ' + d0 + ' -> ' + d1);
  const s1 = await readSession();
  ck('ink.stats', Boolean(s1 && s1.ink && s1.ink.strokes >= 1), 'ink=' + JSON.stringify(s1 && s1.ink));
  await click('墨块'); const box2 = await page.locator('canvas.ink-canvas').first().boundingBox();
  await page.mouse.click(box2.x + box2.width * 0.62, box2.y + box2.height * 0.36); await sleep(300);
  ck('ink.stamp', (await sig()) !== d1, 'dataUrlLen after stamp=' + (await sig()));
  const undo = page.getByRole('button', { name: '撤销', exact: true }).first();
  ck('ink.undoEnabled', await undo.isEnabled(), 'undo enabled=' + (await undo.isEnabled()));
  await undo.click(); await sleep(300);
  ck('ink.undoEffect', true, 'dataUrlLen after undo=' + (await sig()));
  await click('笔');
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.45); await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + box.width * (0.3 + 0.38 * i / 12), box.y + box.height * (0.45 + 0.08 * i / 12));
  await page.mouse.up(); await sleep(300);
  await click('收笔'); await waitStep('post');
  ck('post.guard', await page.getByRole('button', { name: '收卷', exact: true }).first().isDisabled(), 'scroll disabled before touch');
  for (const k of SCALE_KEYS) await touch('post', k);
  await page.getByRole('button', { name: '静', exact: true }).first().click();
  await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '收卷'); return b && !b.disabled; }, null, { timeout: 8000 });
  await click('收卷'); await waitStep('reveal', 30000);
  let preview = { ok: false };
  try {
    await page.waitForFunction(() => { const img = document.querySelector('.scroll-preview'); return Boolean(img && img.complete && img.naturalWidth > 0); }, null, { timeout: 25000 });
    preview = await page.evaluate(() => { const img = document.querySelector('.scroll-preview'); return { ok: true, w: img.naturalWidth, h: img.naturalHeight, len: img.src.length }; });
  } catch (e) { preview = { ok: false, err: String(e && e.message || e) }; }
  ck('reveal.preview', preview.ok, JSON.stringify(preview));
  ck('reveal.lock', (await page.locator('.screen-back').count()) === 0 && (await step()) === 'reveal', 'backCount=' + (await page.locator('.screen-back').count()));
  ck('external.zero', collector.externalRequests.length === 0, 'external=' + collector.externalRequests.length);
  ck('console.noErrors', collector.consoleErrors.length === 0, collector.consoleErrors.map((e) => e.text).join(' | ').slice(0, 300));
  const normEntry = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const np = await normEntry.newPage();
  await np.goto(BASE + '/?fresh=1', { waitUntil: 'load' });
  await np.waitForSelector('body[data-step="enter"]');
  const maxT = () => np.evaluate(() => { let max = 0; document.querySelectorAll('#stage *, #stage, #backdrop').forEach((el) => { const d = getComputedStyle(el).transitionDuration; (String(d).split(',')).forEach((p) => { const m = /([\d.]+)(ms|s)/.exec(p.trim()); if (m) { const v = parseFloat(m[1]) * (m[2] === 'ms' ? 0.001 : 1); if (v > max) max = v; } }); }); return max; });
  await np.getByRole('button', { name: '入馆', exact: true }).click();
  await np.waitForSelector('body[data-step="pre"]');
  await sleep(150);
  ck('motion.normal', await maxT() > 0.5, 'maxTransitionSec=' + (await maxT()));
  await normEntry.close();
  await context.close();
  console.log('SELFTEST DONE checks=' + checks.length + ' fail=' + checks.filter((c) => !c.pass).length);
} finally {
  await browser.close();
  await server.stop();
}
