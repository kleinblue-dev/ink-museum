// 墨馆后端 · HTTP 工具（JSON 响应 / 错误体 / HttpError）
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {{headers?: Record<string,string>, cause?: unknown}} [options]
   */
  constructor(status, code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'HttpError';
    this.status = Number.isInteger(status) ? status : 500;
    this.code = code || 'error';
    this.headers = options.headers ?? null;
  }
}

const NO_STORE = 'no-store';

/**
 * 发送 JSON。API 默认 no-store（馆藏随时可能变化）。
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export function sendJson(req, res, status, payload, options = {}) {
  if (res.writableEnded) return;
  const { headers = {}, cacheControl = NO_STORE } = options;
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(body.length));
  res.setHeader('Cache-Control', cacheControl);
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined && value !== null) res.setHeader(key, String(value));
  }
  if (req && req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
}

/** 统一错误体：{ error: { code, message } }，绝不包含堆栈 */
export function sendError(req, res, status, code, message, headers = {}) {
  sendJson(req, res, status, { error: { code, message } }, { headers });
}

/** 把任意异常映射为安全响应；未预期异常返回 500 且不泄漏细节 */
export function sendUnknownError(req, res, error, logger = console) {
  if (res.headersSent || res.writableEnded) {
    res.destroy?.();
    return;
  }
  const detail = error && typeof error === 'object' ? error.stack ?? String(error) : String(error);
  logger?.error?.(`[ink-museum] 未处理错误：${detail}`);
  sendError(req, res, 500, 'internal_error', '服务器内部错误');
}