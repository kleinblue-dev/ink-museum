// 墨馆后端 · 配置解析测试（默认值 / 环境变量 / 限流可调与可关 / 非法值）
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveConfig, DEFAULTS, PROJECT_ROOT } from '../config.mjs';

test('默认配置：PORT=8790、HOST=127.0.0.1、DATA_DIR=server/data、PUBLIC_DIR=项目根、限流开', () => {
  const config = resolveConfig({ env: {}, argv: [] });
  assert.equal(config.port, 8790);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.dataDir, DEFAULTS.dataDir);
  assert.equal(config.publicDir, PROJECT_ROOT);
  assert.equal(config.trustProxy, false);
  assert.equal(config.noStatic, false);
  assert.equal(config.rateLimitEnabled, true);
  assert.deepEqual(config.saveLimit, { max: 6, windowMs: 10 * 60 * 1000 });
  assert.deepEqual(config.readLimit, { max: 120, windowMs: 60 * 1000 });
  assert.equal(config.maxBodyBytes, 4 * 1024 * 1024);
  assert.equal(config.maxImageBytes, Math.floor(2.5 * 1024 * 1024));
  assert.equal(config.maxInkValue, 100000);
});

test('环境变量：PORT / HOST / DATA_DIR / PUBLIC_DIR / TRUST_PROXY / --no-static', () => {
  const config = resolveConfig({
    env: { PORT: '8899', HOST: '0.0.0.0', DATA_DIR: 'tmp-data', PUBLIC_DIR: 'tmp-public', TRUST_PROXY: '1' },
    argv: ['--no-static']
  });
  assert.equal(config.port, 8899);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.dataDir, path.resolve(process.cwd(), 'tmp-data'));
  assert.equal(config.publicDir, path.resolve(process.cwd(), 'tmp-public'));
  assert.equal(config.trustProxy, true);
  assert.equal(config.noStatic, true);
});

test('限流环境变量：SAVE_LIMIT_MAX / SAVE_LIMIT_WINDOW_MS / READ_LIMIT_MAX / READ_LIMIT_WINDOW_MS', () => {
  const config = resolveConfig({
    env: {
      SAVE_LIMIT_MAX: '200',
      SAVE_LIMIT_WINDOW_MS: '5000',
      READ_LIMIT_MAX: '999',
      READ_LIMIT_WINDOW_MS: '1000'
    }
  });
  assert.deepEqual(config.saveLimit, { max: 200, windowMs: 5000 });
  assert.deepEqual(config.readLimit, { max: 999, windowMs: 1000 });
});

test('RATE_LIMIT=off 关闭限流；on/缺省保持开启', () => {
  assert.equal(resolveConfig({ env: { RATE_LIMIT: 'off' } }).rateLimitEnabled, false);
  assert.equal(resolveConfig({ env: { RATE_LIMIT: '0' } }).rateLimitEnabled, false);
  assert.equal(resolveConfig({ env: { RATE_LIMIT: 'on' } }).rateLimitEnabled, true);
  assert.equal(resolveConfig({ env: {} }).rateLimitEnabled, true);
});

test('测试 overrides 可注入路径 / 限流 / 关闭限流', () => {
  const config = resolveConfig({
    env: {},
    overrides: {
      port: 0,
      dataDir: 'custom-data',
      publicDir: 'custom-public',
      trustProxy: true,
      rateLimitEnabled: false,
      limits: { save: { max: 3 }, read: { windowMs: 1000 } }
    }
  });
  assert.equal(config.port, 0);
  assert.equal(config.dataDir, path.resolve(process.cwd(), 'custom-data'));
  assert.equal(config.publicDir, path.resolve(process.cwd(), 'custom-public'));
  assert.equal(config.trustProxy, true);
  assert.equal(config.rateLimitEnabled, false);
  assert.deepEqual(config.saveLimit, { max: 3, windowMs: 10 * 60 * 1000 });
  assert.deepEqual(config.readLimit, { max: 120, windowMs: 1000 });
});

test('非法 PORT / 非法限流数字 → 抛错', () => {
  assert.throws(() => resolveConfig({ env: { PORT: 'abc' } }), /PORT/);
  assert.throws(() => resolveConfig({ env: { PORT: '70000' } }), /PORT/);
  assert.throws(() => resolveConfig({ env: { SAVE_LIMIT_MAX: '0' } }), /SAVE_LIMIT_MAX/);
  assert.throws(() => resolveConfig({ env: { READ_LIMIT_WINDOW_MS: 'abc' } }), /READ_LIMIT_WINDOW_MS/);
});