// 极简静态服务器（local 模式用：只服务文件，无 /api → 前台自动降级本机存储）
// 用法：node scripts/serve-static.mjs [port]   默认 http://127.0.0.1:8791
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8791);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav'
};
const SEC = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self' data:; base-uri 'none'; form-action 'none'"
};
http.createServer((req, res) => {
  // 静态预览模式下给前台一个明确的“无后端”健康响应：
  // 避免 /api/health 404 在浏览器控制台留红错；ok:false 会让前台自动走 local 模式。
  if (req.url && req.url.split('?')[0] === '/api/health') {
    res.writeHead(200, { ...SEC, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: false, mode: 'static', version: '1.0.0' }));
    return;
  }
  try {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    const abs = path.resolve(ROOT, '.' + urlPath);
    if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) { res.writeHead(403, SEC); res.end('403'); return; }
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) { res.writeHead(404, { ...SEC, 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404'); return; }
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, { ...SEC, 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
    fs.createReadStream(abs).pipe(res);
  } catch (e) {
    res.writeHead(500, SEC); res.end('500');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`静态预览：http://127.0.0.1:${PORT}/`));
