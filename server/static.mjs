// 墨馆后端 · 静态托管（PUBLIC_DIR，防路径穿越）
import fsp from 'node:fs/promises';
import path from 'node:path';
import { sendError } from './http-util.mjs';

export const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
});

const HTML_CACHE = 'no-cache';
const ASSET_CACHE = 'public, max-age=3600';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** 干净 404 页：可见文字全部取自 content（不散落硬编码中文） */
function buildNotFoundPage(content) {
  const title = escapeHtml(content?.museum?.title ?? 'ink-museum');
  const enter = escapeHtml(content?.museum?.enter ?? 'home');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>404 · ${title}</title>
<style>
  :root { color-scheme: light; }
  html, body { height: 100%; }
  body { margin: 0; display: grid; place-items: center; background: #f4f1ea; color: #26221c;
         font: 15px/1.8 "Noto Serif SC", "Songti SC", serif; }
  main { text-align: center; padding: 24px; }
  .code { margin: 0; font-size: 48px; letter-spacing: .12em; opacity: .28; }
  .brand { margin: 8px 0 20px; letter-spacing: .3em; opacity: .72; }
  a { color: inherit; text-decoration: none; border-bottom: 1px solid rgba(38,34,28,.4); padding-bottom: 2px; }
  a:hover { border-bottom-color: rgba(38,34,28,.9); }
</style>
</head>
<body>
<main>
  <p class="code">404</p>
  <p class="brand">${title}</p>
  <a href="/">${enter}</a>
</main>
</body>
</html>
`;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/**
 * @param {{publicDir: string, content: any, logger?: Console}} options
 */
export function createStaticHandler({ publicDir, content, logger = console }) {
  const root = path.resolve(publicDir);
  const notFoundPage = buildNotFoundPage(content);
  let realRootPromise = null;

  async function getRealRoot() {
    if (realRootPromise === null) {
      realRootPromise = fsp.realpath(root).catch(() => root);
    }
    return realRootPromise;
  }

  function sendNotFound(req, res) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Length', String(Buffer.byteLength(notFoundPage)));
    res.setHeader('Cache-Control', 'no-cache');
    if (req.method === 'HEAD') res.end();
    else res.end(notFoundPage);
  }

  function sendForbidden(req, res) {
    sendError(req, res, 403, 'forbidden', '路径越界');
  }

  /**
   * 返回 true 表示已处理。
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string} pathname
   */
  async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendError(req, res, 405, 'method_not_allowed', '静态资源只支持 GET/HEAD', { Allow: 'GET, HEAD' });
      return;
    }
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      sendError(req, res, 400, 'bad_path', '路径编码无效');
      return;
    }
    if (decoded.includes(String.fromCharCode(0))) {
      sendError(req, res, 400, 'bad_path', '路径包含非法字符');
      return;
    }
    let relative = decoded.startsWith('/') ? decoded : `/${decoded}`;
    if (relative === '/') relative = '/index.html';
    else if (relative.endsWith('/')) relative = `${relative}index.html`;

    const target = path.resolve(root, `.${relative}`);
    if (!isInside(root, target)) {
      sendForbidden(req, res);
      return;
    }

    let stat;
    try {
      stat = await fsp.stat(target);
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
        sendNotFound(req, res);
        return;
      }
      throw error;
    }

    let filePath = target;
    if (stat.isDirectory()) {
      filePath = path.join(target, 'index.html');
      try {
        stat = await fsp.stat(filePath);
      } catch {
        sendNotFound(req, res);
        return;
      }
      if (!isInside(root, filePath)) {
        sendForbidden(req, res);
        return;
      }
    }
    if (!stat.isFile()) {
      sendNotFound(req, res);
      return;
    }

    // 防符号链接越界（只读校验；publicDir 内正常文件不受影响）
    try {
      const realRoot = await getRealRoot();
      const realTarget = await fsp.realpath(filePath);
      if (!isInside(realRoot, realTarget)) {
        sendForbidden(req, res);
        return;
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        sendNotFound(req, res);
        return;
      }
      throw error;
    }

    const body = await fsp.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[extension] ?? 'application/octet-stream';
    const isHtml = mime.startsWith('text/html');
    res.statusCode = 200;
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(body.length));
    res.setHeader('Cache-Control', isHtml ? HTML_CACHE : ASSET_CACHE);
    if (req.method === 'HEAD') res.end();
    else res.end(body);
  }

  void logger;
  return serveStatic;
}