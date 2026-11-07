// 墨馆后端 · 应用组装（HTTP 服务 + 路由 + 限流 + 静态托管）
// 设计：createApp() 可注入配置（测试用临时 DATA_DIR + 端口 0）；index.mjs 负责 CLI 与环境变量。
import http from 'node:http';
import crypto from 'node:crypto';
import { resolveConfig, SERVER_VERSION } from './config.mjs';
import { content, contentVersion, sceneIdSet } from './content.mjs';
import { HttpError, sendError, sendJson, sendUnknownError } from './http-util.mjs';
import { applySecurityHeaders } from './security.mjs';
import { createRateLimiter, createNoopLimiter } from './ratelimit.mjs';
import { openStore, toPublicRecord, toDetailRecord, imageUrlFor, imageTypeOf } from './store.mjs';
import { createStaticHandler } from './static.mjs';
import { sha256Hex, isWebpMagic, isPngMagic } from './media.mjs';
import { validateScrollPayload, payloadFingerprint } from './validate.mjs';

const ID_PATTERN = /^[A-Za-z0-9-]{4,80}$/;
const IDEM_HASH_PREFIX = 'idem:';
const IMAGE_ROUTE = /^\/api\/scrolls\/([^/]+)\/image\.(webp|png)$/;
const DETAIL_ROUTE = /^\/api\/scrolls\/([^/]+)$/;
const HARD_BODY_CAP_FACTOR = 8;

export function buildDisplayUrl(host, port) {
  let displayHost = host;
  if (host === '0.0.0.0') displayHost = '127.0.0.1';
  else if (host === '::' || host === '::0') displayHost = '[::1]';
  else if (host.includes(':') && !host.startsWith('[')) displayHost = `[${host}]`;
  return `http://${displayHost}:${port}`;
}

/** 默认取 socket IP；仅 TRUST_PROXY=1 时信任 x-forwarded-for 第一跳 */
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (typeof raw === 'string' && raw.trim().length > 0) {
      const first = raw.split(',')[0].trim();
      if (first.length > 0) return first.slice(0, 100);
    }
  }
  const socketAddress = req.socket?.remoteAddress ?? 'unknown';
  return socketAddress.startsWith('::ffff:') ? socketAddress.slice(7) : socketAddress;
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseListLimit(raw, config) {
  if (raw === null || raw === '') return config.defaultListLimit;
  if (!/^\d+$/.test(raw)) throw new HttpError(400, 'invalid_limit', 'limit 必须是正整数');
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1) throw new HttpError(400, 'invalid_limit', 'limit 必须是正整数');
  return Math.min(limit, config.maxListLimit);
}

function encodeCursor(offset) {
  return Buffer.from(`o:${offset}`, 'utf8').toString('base64url');
}

function decodeCursor(raw) {
  if (raw === null || raw === '') return 0;
  let text = '';
  try {
    text = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    text = '';
  }
  const match = /^o:(\d{1,9})$/.exec(text);
  if (!match) throw new HttpError(400, 'invalid_cursor', 'cursor 无效（应使用上一次返回的 nextCursor）');
  return Number(match[1]);
}

function decodeIdSegment(raw) {
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!ID_PATTERN.test(decoded)) return null;
  return decoded;
}

/** 读取请求体；超过 limit 后继续排空连接，再返回 413（避免客户端 socket 重置） */
async function readBody(req, limit) {
  const hardCap = limit * HARD_BODY_CAP_FACTOR;
  const chunks = [];
  let total = 0;
  let overflow = false;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > hardCap) {
      req.destroy();
      throw new HttpError(413, 'payload_too_large', '请求体过大');
    }
    if (total > limit) {
      overflow = true;
      chunks.length = 0;
      continue;
    }
    chunks.push(chunk);
  }
  if (overflow) throw new HttpError(413, 'payload_too_large', `请求体上限 ${limit} 字节（4MB）`);
  if (total === 0) throw new HttpError(400, 'invalid_body', '请求体为空');
  return Buffer.concat(chunks, total);
}

/**
 * 创建应用（不监听）。测试与 CLI 共用。
 * @param {{env?: Record<string,string|undefined>, argv?: string[], now?: () => number, logger?: Console} & Record<string, unknown>} [options]
 */
export async function createApp(options = {}) {
  const {
    env = process.env,
    argv = [],
    now = () => Date.now(),
    logger = console,
    ...configOverrides
  } = options ?? {};
  const config = resolveConfig({ env, argv, overrides: configOverrides });
  const store = await openStore({ dataDir: config.dataDir, logger });
  const limiters = config.rateLimitEnabled
    ? {
        save: createRateLimiter({ ...config.saveLimit, name: 'save' }),
        read: createRateLimiter({ ...config.readLimit, name: 'read' })
      }
    : { save: createNoopLimiter('save'), read: createNoopLimiter('read') };
  const serveStatic = config.noStatic
    ? null
    : createStaticHandler({ publicDir: config.publicDir, content, logger });
  /** @type {Map<string, Promise<any>>} 同 key 并发请求合流 */
  const inflight = new Map();
  let boundPort = null;

  const currentNow = () => now();
  const createdAtNow = () => new Date(currentNow()).toISOString();

  function methodNotAllowed(req, res, allow) {
    sendError(req, res, 405, 'method_not_allowed', '不支持的请求方法', { Allow: allow.join(', ') });
  }

  function rateLimited(req, res, gate) {
    sendError(req, res, 429, 'rate_limited', `请求太频繁，请 ${gate.retryAfterSec} 秒后再试`, {
      'Retry-After': String(gate.retryAfterSec)
    });
  }

  function passSaveLimit(req, res) {
    const gate = limiters.save.consume(clientIp(req, config.trustProxy), currentNow());
    if (!gate.allowed) {
      rateLimited(req, res, gate);
      return false;
    }
    return true;
  }

  function passReadLimit(req, res) {
    const gate = limiters.read.consume(clientIp(req, config.trustProxy), currentNow());
    if (!gate.allowed) {
      rateLimited(req, res, gate);
      return false;
    }
    return true;
  }

  function healthPayload() {
    return {
      ok: true,
      version: contentVersion,
      mode: 'server',
      serverVersion: SERVER_VERSION,
      contentVersion,
      features: { static: !config.noStatic, rateLimit: config.rateLimitEnabled },
      time: createdAtNow()
    };
  }

  function createdPayload(record) {
    const imageUrl = imageUrlFor(record);
    return {
      id: record.id,
      imageUrl,
      thumbUrl: imageUrl,
      createdAt: record.createdAt,
      sceneId: record.sceneId,
      mood: record.mood ?? null
    };
  }

  function replayScroll(req, res, record, fingerprint) {
    if (typeof record.payloadHash === 'string' && record.payloadHash.length > 0 && record.payloadHash !== fingerprint) {
      throw new HttpError(409, 'idempotency_conflict', '同一 Idempotency-Key 提交了不同内容');
    }
    sendJson(req, res, 200, createdPayload(record), { headers: { 'Idempotent-Replay': 'true' } });
  }

  function buildRecord(normalized, { idemHash, fingerprint }) {
    const id = crypto.randomUUID();
    return {
      v: 1,
      id,
      schemaVersion: normalized.schemaVersion,
      contentVersion,
      serverVersion: SERVER_VERSION,
      clientId: normalized.clientId, // 匿名本机 ID，无 PII（见 docs/API.md 隐私边界）
      clientIdHash: normalized.clientIdHash,
      sceneId: normalized.sceneId,
      mood: normalized.mood,
      pre: normalized.pre,
      post: normalized.post,
      ink: normalized.ink,
      image: {
        file: `${id}.${normalized.image.type}`,
        type: normalized.image.type,
        mime: normalized.image.mime,
        bytes: normalized.image.bytes,
        sha256: normalized.image.sha256
      },
      idemHash,
      payloadHash: fingerprint,
      createdAt: createdAtNow()
    };
  }

  async function handleCreate(req, res) {
    const rawKey = req.headers['idempotency-key'];
    const idemKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (typeof idemKey !== 'string' || idemKey.trim().length === 0) {
      throw new HttpError(400, 'missing_idempotency_key', '缺少 Idempotency-Key 请求头');
    }
    if (idemKey.length > 200) {
      throw new HttpError(400, 'invalid_idempotency_key', 'Idempotency-Key 最长 200 字符');
    }
    const mediaType = String(req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
    if (mediaType !== 'application/json') {
      throw new HttpError(415, 'unsupported_media_type', 'Content-Type 必须是 application/json');
    }

    const raw = await readBody(req, config.maxBodyBytes);
    let body;
    try {
      body = JSON.parse(stripBom(raw.toString('utf8')));
    } catch {
      throw new HttpError(400, 'invalid_json', '请求体不是合法 JSON');
    }

    const normalized = validateScrollPayload(body, {
      maxImageBytes: config.maxImageBytes,
      maxInkValue: config.maxInkValue
    });
    const idemHash = sha256Hex(`${IDEM_HASH_PREFIX}${idemKey}`);
    const fingerprint = payloadFingerprint(normalized);

    const existing = store.findByIdem(idemHash);
    if (existing) {
      replayScroll(req, res, existing, fingerprint);
      return;
    }
    const pending = inflight.get(idemHash);
    if (pending) {
      const record = await pending;
      replayScroll(req, res, record, fingerprint);
      return;
    }

    const record = buildRecord(normalized, { idemHash, fingerprint });
    const task = store.save({ record, imageBuffer: normalized.image.buffer });
    inflight.set(idemHash, task);
    let saved;
    try {
      saved = await task;
    } finally {
      inflight.delete(idemHash);
    }
    sendJson(req, res, 201, createdPayload(saved));
  }

  function handleList(req, res, url) {
    const sceneRaw = url.searchParams.get('scene');
    let sceneId = null;
    if (sceneRaw !== null && sceneRaw !== '') {
      if (!sceneIdSet.has(sceneRaw)) throw new HttpError(400, 'invalid_scene', 'scene 不在 content.scenes 中');
      sceneId = sceneRaw;
    }
    const limit = parseListLimit(url.searchParams.get('limit'), config);
    const offset = decodeCursor(url.searchParams.get('cursor'));
    const page = store.list({ limit, sceneId, offset });
    sendJson(req, res, 200, {
      items: page.items.map(toPublicRecord),
      total: page.total,
      nextCursor: page.nextOffset === null ? null : encodeCursor(page.nextOffset)
    });
  }

  function handleDetail(req, res, rawId) {
    const id = decodeIdSegment(rawId);
    const record = id === null ? undefined : store.get(id);
    if (!record) throw new HttpError(404, 'scroll_not_found', '画卷不存在');
    sendJson(req, res, 200, toDetailRecord(record));
  }

  async function handleImage(req, res, rawId, requestedType) {
    const id = decodeIdSegment(rawId);
    const record = id === null ? undefined : store.get(id);
    if (!record) throw new HttpError(404, 'scroll_not_found', '画卷不存在');
    if (requestedType !== imageTypeOf(record)) {
      throw new HttpError(404, 'image_not_found', '画卷图片不存在（URL 扩展名与图片实际类型不一致）');
    }
    const buffer = await store.readImage(record.id);
    if (!buffer) throw new HttpError(404, 'image_not_found', '画卷图片不存在');
    const mime = typeof record.image?.mime === 'string'
      ? record.image.mime
      : isWebpMagic(buffer) ? 'image/webp' : isPngMagic(buffer) ? 'image/png' : 'application/octet-stream';
    const etag = typeof record.image?.sha256 === 'string' && record.image.sha256.length > 0
      ? `"${record.image.sha256.slice(0, 32)}"`
      : null;
    if (etag !== null && req.headers['if-none-match'] === etag) {
      res.statusCode = 304;
      res.setHeader('ETag', etag);
      res.end();
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (etag !== null) res.setHeader('ETag', etag);
    if (req.method === 'HEAD') res.end();
    else res.end(buffer);
  }

  async function handleRequest(req, res) {
    applySecurityHeaders(res);
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      sendError(req, res, 400, 'bad_request', '无法解析请求 URL');
      return;
    }
    const pathname = url.pathname;
    const method = req.method === 'HEAD' ? 'GET' : req.method;

    try {
      if (pathname === '/api/health') {
        if (method !== 'GET') return methodNotAllowed(req, res, ['GET', 'HEAD']);
        return sendJson(req, res, 200, healthPayload());
      }
      if (pathname === '/api/content') {
        if (method !== 'GET') return methodNotAllowed(req, res, ['GET', 'HEAD']);
        if (!passReadLimit(req, res)) return;
        return sendJson(req, res, 200, content, { cacheControl: 'no-cache' });
      }
      if (pathname === '/api/stats') {
        if (method !== 'GET') return methodNotAllowed(req, res, ['GET', 'HEAD']);
        if (!passReadLimit(req, res)) return;
        const stats = store.stats();
        return sendJson(req, res, 200, {
          ...stats,
          contentVersion,
          generatedAt: createdAtNow()
        });
      }
      if (pathname === '/api/scrolls') {
        if (method === 'POST') {
          if (!passSaveLimit(req, res)) return;
          return await handleCreate(req, res);
        }
        if (method === 'GET') {
          if (!passReadLimit(req, res)) return;
          return handleList(req, res, url);
        }
        return methodNotAllowed(req, res, ['GET', 'HEAD', 'POST']);
      }
      const imageMatch = IMAGE_ROUTE.exec(pathname);
      if (imageMatch) {
        if (method !== 'GET') return methodNotAllowed(req, res, ['GET', 'HEAD']);
        if (!passReadLimit(req, res)) return;
        return await handleImage(req, res, imageMatch[1], imageMatch[2]);
      }
      const detailMatch = DETAIL_ROUTE.exec(pathname);
      if (detailMatch) {
        if (method !== 'GET') return methodNotAllowed(req, res, ['GET', 'HEAD']);
        if (!passReadLimit(req, res)) return;
        return handleDetail(req, res, detailMatch[1]);
      }
      if (pathname === '/api' || pathname.startsWith('/api/')) {
        return sendError(req, res, 404, 'not_found', '没有这个接口');
      }
      if (serveStatic === null) {
        return sendError(req, res, 404, 'static_disabled', '静态托管已禁用（--no-static）');
      }
      return await serveStatic(req, res, pathname);
    } catch (error) {
      if (error instanceof HttpError) {
        sendError(req, res, error.status, error.code, error.message, error.headers ?? {});
        return;
      }
      sendUnknownError(req, res, error, logger);
    }
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => sendUnknownError(req, res, error, logger));
  });
  server.on('clientError', (error, socket) => {
    if (!socket.writable || socket.writableEnded) {
      socket.destroy?.();
      return;
    }
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: 11\r\n\r\nBad Request');
  });
  server.requestTimeout = 120000;
  server.headersTimeout = 30000;

  async function listen() {
    if (server.listening) {
      const address = server.address();
      boundPort = typeof address === 'object' && address !== null ? address.port : config.port;
      return { port: boundPort, url: buildDisplayUrl(config.host, boundPort) };
    }
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      try {
        server.listen(config.port, config.host);
      } catch (error) {
        reject(error);
      }
    });
    const address = server.address();
    boundPort = typeof address === 'object' && address !== null ? address.port : config.port;
    return { port: boundPort, url: buildDisplayUrl(config.host, boundPort) };
  }

  async function close() {
    if (server.listening) {
      await new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
          try {
            server.closeAllConnections?.();
          } catch {
            /* ignore */
          }
          finish();
        }, Math.min(config.shutdownTimeoutMs, 2000));
        timer.unref?.();
        function finish() {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve();
        }
        server.close(() => finish());
        server.closeIdleConnections?.();
      });
    }
    await store.close();
  }

  return {
    server,
    config,
    content,
    store,
    limiters,
    listen,
    close,
    get port() {
      const address = server.address();
      return typeof address === 'object' && address !== null ? address.port : boundPort ?? config.port;
    },
    get url() {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : config.port;
      return buildDisplayUrl(config.host, port);
    },
    get address() {
      return server.address();
    }
  };
}

/** 创建 + 监听（CLI 与测试共用） */
export async function startServer(options = {}) {
  const app = await createApp(options);
  try {
    await app.listen();
  } catch (error) {
    await app.close();
    throw error;
  }
  return app;
}