// 墨馆后端 · 配置解析（零依赖）
// 环境变量：PORT / HOST / DATA_DIR / PUBLIC_DIR / TRUST_PROXY
//          SAVE_LIMIT_MAX / SAVE_LIMIT_WINDOW_MS / READ_LIMIT_MAX / READ_LIMIT_WINDOW_MS / RATE_LIMIT
// 命令行：--no-static（只跑 API）
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));

export const SERVER_VERSION = '1.0.0';
/** 项目根（server/ 的上一级） */
export const PROJECT_ROOT = path.resolve(SERVER_DIR, '..');
/** 默认数据目录 server/data（已在 .gitignore 中） */
export const SERVER_DATA_DIR = path.join(SERVER_DIR, 'data');

export const MB = 1024 * 1024;

export const DEFAULTS = Object.freeze({
  port: 8790,
  host: '127.0.0.1',
  dataDir: SERVER_DATA_DIR,
  publicDir: PROJECT_ROOT,
  trustProxy: false,
  noStatic: false,
  rateLimitEnabled: true,
  maxBodyBytes: 4 * MB, // POST 请求体上限
  maxImageBytes: Math.floor(2.5 * MB), // 图片解码后上限
  maxInkValue: 100000, // ink 三字段上限
  defaultListLimit: 24,
  maxListLimit: 60,
  saveLimit: Object.freeze({ max: 6, windowMs: 10 * 60 * 1000 }), // 保存：6 次 / 10 分钟 / IP
  readLimit: Object.freeze({ max: 120, windowMs: 60 * 1000 }), // 读：120 次 / 分钟 / IP
  shutdownTimeoutMs: 5000
});

const CONFIG_OVERRIDE_KEYS = new Set([
  'port', 'host', 'dataDir', 'publicDir', 'trustProxy', 'noStatic', 'rateLimitEnabled',
  'maxBodyBytes', 'maxImageBytes', 'maxInkValue', 'defaultListLimit',
  'maxListLimit', 'saveLimit', 'readLimit', 'shutdownTimeoutMs'
]);

function readBool(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return undefined;
}

/** RATE_LIMIT=off|0|false|disabled 关闭限流（仅本地/测试用） */
function readRateLimitEnabled(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const text = String(value).trim().toLowerCase();
  if (['off', '0', 'false', 'no', 'disabled'].includes(text)) return false;
  if (['on', '1', 'true', 'yes', 'enabled'].includes(text)) return true;
  return undefined;
}

function readPort(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT 必须是 0..65535 的整数，收到：${JSON.stringify(String(value))}`);
  }
  return port;
}

function readPositiveInt(value, fallback, name) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${name} 必须是正整数，收到：${JSON.stringify(String(value))}`);
  }
  return number;
}

/** 相对路径按 process.cwd() 解析；绝对路径保持不变 */
function readPath(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return path.resolve(process.cwd(), String(value));
}

/**
 * 合并默认值 + 环境变量 + 命令行参数 + 测试覆盖项。
 * @param {{env?: Record<string,string|undefined>, argv?: string[], overrides?: Record<string, unknown>}} [input]
 */
export function resolveConfig({ env = process.env, argv = [], overrides = {} } = {}) {
  const config = {
    port: readPort(env.PORT, DEFAULTS.port),
    host: (env.HOST && String(env.HOST).trim()) || DEFAULTS.host,
    dataDir: readPath(env.DATA_DIR, DEFAULTS.dataDir),
    publicDir: readPath(env.PUBLIC_DIR, DEFAULTS.publicDir),
    trustProxy: readBool(env.TRUST_PROXY) ?? DEFAULTS.trustProxy,
    noStatic: Array.isArray(argv) && argv.includes('--no-static'),
    rateLimitEnabled: readRateLimitEnabled(env.RATE_LIMIT) ?? DEFAULTS.rateLimitEnabled,
    maxBodyBytes: DEFAULTS.maxBodyBytes,
    maxImageBytes: DEFAULTS.maxImageBytes,
    maxInkValue: DEFAULTS.maxInkValue,
    defaultListLimit: DEFAULTS.defaultListLimit,
    maxListLimit: DEFAULTS.maxListLimit,
    saveLimit: {
      max: readPositiveInt(env.SAVE_LIMIT_MAX, DEFAULTS.saveLimit.max, 'SAVE_LIMIT_MAX'),
      windowMs: readPositiveInt(env.SAVE_LIMIT_WINDOW_MS, DEFAULTS.saveLimit.windowMs, 'SAVE_LIMIT_WINDOW_MS')
    },
    readLimit: {
      max: readPositiveInt(env.READ_LIMIT_MAX, DEFAULTS.readLimit.max, 'READ_LIMIT_MAX'),
      windowMs: readPositiveInt(env.READ_LIMIT_WINDOW_MS, DEFAULTS.readLimit.windowMs, 'READ_LIMIT_WINDOW_MS')
    },
    shutdownTimeoutMs: DEFAULTS.shutdownTimeoutMs
  };

  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === undefined) continue;
    if (key === 'limits' && value && typeof value === 'object') {
      if (value.save && typeof value.save === 'object') config.saveLimit = { ...config.saveLimit, ...value.save };
      if (value.read && typeof value.read === 'object') config.readLimit = { ...config.readLimit, ...value.read };
      continue;
    }
    if (!CONFIG_OVERRIDE_KEYS.has(key)) continue;
    if (key === 'saveLimit' || key === 'readLimit') {
      config[key] = { ...config[key], ...value };
      continue;
    }
    config[key] = value;
  }

  config.port = readPort(config.port, DEFAULTS.port);
  config.maxBodyBytes = readPositiveInt(config.maxBodyBytes, DEFAULTS.maxBodyBytes, 'maxBodyBytes');
  config.maxImageBytes = readPositiveInt(config.maxImageBytes, DEFAULTS.maxImageBytes, 'maxImageBytes');
  config.maxInkValue = readPositiveInt(config.maxInkValue, DEFAULTS.maxInkValue, 'maxInkValue');
  config.defaultListLimit = readPositiveInt(config.defaultListLimit, DEFAULTS.defaultListLimit, 'defaultListLimit');
  config.maxListLimit = readPositiveInt(config.maxListLimit, DEFAULTS.maxListLimit, 'maxListLimit');
  config.saveLimit.max = readPositiveInt(config.saveLimit.max, DEFAULTS.saveLimit.max, 'saveLimit.max');
  config.saveLimit.windowMs = readPositiveInt(config.saveLimit.windowMs, DEFAULTS.saveLimit.windowMs, 'saveLimit.windowMs');
  config.readLimit.max = readPositiveInt(config.readLimit.max, DEFAULTS.readLimit.max, 'readLimit.max');
  config.readLimit.windowMs = readPositiveInt(config.readLimit.windowMs, DEFAULTS.readLimit.windowMs, 'readLimit.windowMs');
  config.host = String(config.host || DEFAULTS.host);
  config.trustProxy = Boolean(config.trustProxy);
  config.noStatic = Boolean(config.noStatic);
  config.rateLimitEnabled = Boolean(config.rateLimitEnabled);
  config.dataDir = path.resolve(process.cwd(), String(config.dataDir));
  config.publicDir = path.resolve(process.cwd(), String(config.publicDir));
  return config;
}