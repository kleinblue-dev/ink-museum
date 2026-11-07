import path from 'node:path';
import { spawnQaServer, launchBrowser, PROJECT_ROOT, sleep } from './harness.mjs';
const BASE = 'http://127.0.0.1:8794';
const server = await spawnQaServer({ baseURL: BASE, entryRel: 'scripts/serve-static.mjs', serverLogPath: path.join(PROJECT_ROOT, '_qa-artifacts', 'selftest', 'probe2-server.log') });
const { browser } = await launchBrowser({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const waitStep = (s, t = 15000) => page.waitForSelector('body[data-step="' + s + '"]', { timeout: t });
  const click = async (n) => { const l = page.getByRole('button', { name: n, exact: true }).first(); await l.waitFor({ state: 'visible' }); await l.click(); };
  const touch = async (ph, k) => { const i = page.locator('input#' + ph + '-' + k).first(); await i.click(); await i.press('ArrowRight'); await sleep(60); };
  await page.goto(BASE + '/?fresh=1', { waitUntil: 'load' }); await waitStep('enter');
  await click('入馆'); await waitStep('pre');
  for (const k of ['tight', 'tired', 'scattered']) await touch('pre', k);
  await click('往里走'); await waitStep('scene');
  await page.getByRole('button', { name: /早春/ }).first().click(); await waitStep('line');
  await click('看一看'); await page.waitForSelector('.line-next.is-visible');
  await click('落墨'); await waitStep('ink');
  await page.locator('canvas.ink-canvas').first().waitFor({ state: 'visible' });
  const box = await page.locator('canvas.ink-canvas').first().boundingBox();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.4); await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + box.width * (0.35 + 0.3 * i / 12), box.y + box.height * (0.4 + 0.15 * i / 12));
  await page.mouse.up();
  const read = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('ink-museum.session.v1') || 'null'); } catch (e) { return null; } });
  for (let i = 0; i < 10; i += 1) { await sleep(250); const s = await read(); console.log('t=' + ((i + 1) * 250) + 'ms ink=' + JSON.stringify(s && s.ink)); }
  // reveal 过渡期间的 .screen 数量 / .screen-back 数量
  await click('收笔'); await waitStep('post');
  for (const k of ['tight', 'tired', 'scattered']) await touch('post', k);
  await page.getByRole('button', { name: '静', exact: true }).first().click();
  await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '收卷'); return b && !b.disabled; });
  await click('收卷'); await waitStep('reveal');
  for (let i = 0; i < 8; i += 1) {
    const info = await page.evaluate(() => ({ screens: document.querySelectorAll('#stage .screen').length, backs: document.querySelectorAll('.screen-back').length, step: document.body.dataset.step, steps: [...document.querySelectorAll('#stage .screen')].map((s) => s.className) }));
    console.log('reveal t=' + (i * 250) + 'ms ' + JSON.stringify(info));
    await sleep(250);
  }
  const session = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('ink-museum.session.v1') || 'null'); } catch (e) { return null; } });
  console.log('reveal session.step=' + (session && session.step) + ' ink=' + JSON.stringify(session && session.ink) + ' finishedAt=' + (session && session.finishedAt));
  await context.close();
} finally { await browser.close(); await server.stop(); }
