// 墨馆后端 · CLI 入口测试（真实 spawn node server/index.mjs，PORT=0 + 临时目录）
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { PROJECT_ROOT } from '../config.mjs';
import { makeTempDir, makePublicFixture, removeDir, fetchJson } from './helpers.mjs';

function startCli({ args = [], env = {} } = {}) {
  const child = spawn(process.execPath, ['server/index.mjs', ...args], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: '0',
      HOST: '127.0.0.1',
      TRUST_PROXY: '0',
      RATE_LIMIT: '',
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const state = { child, stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    state.stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    state.stderr += chunk;
  });
  return state;
}

async function waitForUrl(state, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const match = /listening on (http:\/\/\S+)/.exec(state.stdout);
    if (match) return match[1];
    if (state.child.exitCode !== null) {
      throw new Error(`CLI 提前退出 code=${state.child.exitCode}\nstdout=${state.stdout}\nstderr=${state.stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`等待 CLI 就绪超时\nstdout=${state.stdout}\nstderr=${state.stderr}`);
}

async function stopCli(state) {
  if (state.child.exitCode !== null) return;
  state.child.kill('SIGKILL');
  await new Promise((resolve) => {
    state.child.once('exit', resolve);
    setTimeout(resolve, 3000);
  });
}

test('node server/index.mjs：PORT=0 就绪日志 + 健康检查 + 静态托管', async () => {
  const dataDir = await makeTempDir('ink-museum-cli-');
  const fixture = await makePublicFixture();
  const cli = startCli({ env: { DATA_DIR: dataDir, PUBLIC_DIR: fixture.publicDir } });
  try {
    const url = await waitForUrl(cli);
    assert.match(cli.stdout, /listening on http:\/\/\S+ mode=static\+api/);
    const health = await fetchJson(`${url}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.mode, 'server');
    assert.equal(health.body.features.static, true);
    const page = await fetch(`${url}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /墨馆测试首页/);
    const content = await fetchJson(`${url}/api/content`);
    assert.equal(content.status, 200);
  } finally {
    await stopCli(cli);
    await removeDir(dataDir);
    await removeDir(fixture.root);
  }
});

test('node server/index.mjs --no-static：mode=api，静态路径 404 JSON', async () => {
  const dataDir = await makeTempDir('ink-museum-cli-');
  const fixture = await makePublicFixture();
  const cli = startCli({ args: ['--no-static'], env: { DATA_DIR: dataDir, PUBLIC_DIR: fixture.publicDir, RATE_LIMIT: 'off' } });
  try {
    const url = await waitForUrl(cli);
    assert.match(cli.stdout, /mode=api\b/);
    assert.match(cli.stdout, /限流\s+已关闭/);
    const page = await fetchJson(`${url}/`);
    assert.equal(page.status, 404);
    assert.equal(page.body.error.code, 'static_disabled');
    const health = await fetchJson(`${url}/api/health`);
    assert.equal(health.body.features.static, false);
    assert.equal(health.body.features.rateLimit, false);
  } finally {
    await stopCli(cli);
    await removeDir(dataDir);
    await removeDir(fixture.root);
  }
});