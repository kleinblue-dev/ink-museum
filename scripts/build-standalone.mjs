// 单文件离线构建：index.html + CSS + ES modules + 图片 + 掩膜 → dist/standalone.html
// 依赖约定：只用具名导出/具名 import，无 export default（content.js 除外）、无动态 import。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
const ENTRY = 'js/main.js';
const errors = [];
const err = (m) => { errors.push(m); console.error('ERR ' + m); };
const warn = (m) => console.warn('WARN ' + m);
const readText = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

if (!exists('index.html')) { console.error('index.html 不存在，无法构建'); process.exit(1); }

// ---------- 模块图 ----------
const moduleAbs = new Map();
const moduleOrder = [];
const visiting = new Set();
function resolveRel(fromAbs, spec) {
  if (!spec.startsWith('.')) err(`只允许相对 import：${spec}（in ${path.relative(ROOT, fromAbs)}）`);
  return path.resolve(path.dirname(fromAbs), spec);
}
function collect(fromAbs) {
  if (moduleAbs.has(fromAbs)) return;
  if (visiting.has(fromAbs)) { err('循环 import: ' + path.relative(ROOT, fromAbs)); return; }
  visiting.add(fromAbs);
  const code = fs.readFileSync(fromAbs, 'utf8');
  const imports = [];
  const lines = code.split(/\r?\n/);
  for (const ln of lines) {
    const m = ln.match(/^\s*import\s+(?:(\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]\s*;?\s*$/);
    if (m) {
      if (m[1] && /^\*\s+as/.test(m[1])) err(path.relative(ROOT, fromAbs) + ' 使用了 import * as，打包器不支持');
      if (m[1] && !m[1].startsWith('{')) err(path.relative(ROOT, fromAbs) + ' 使用了默认导入，打包器不支持');
      imports.push(resolveRel(fromAbs, m[2]));
    }
  }
  const rest = lines.filter((ln) => !/^\s*import\s/.test(ln)).join('\n');
  if (/^\s*import\s/m.test(rest) || /\bexport\s+\{/.test(rest) || /\bexport\s+\*/m.test(rest)) err(path.relative(ROOT, fromAbs) + ' 含打包器不支持的 import/export 形式');
  if (/\bimport\s*\(/.test(rest)) err(path.relative(ROOT, fromAbs) + ' 含动态 import()，打包器不支持');
  if (/^\s*export\s+default\b/m.test(rest)) {
    if (/content[\\/]content\.js$/.test(fromAbs)) {
      // content.js 的 default 导出不被使用，剥掉
    } else err(path.relative(ROOT, fromAbs) + ' 含 export default，请改具名导出');
  }
  let out = rest
    .replace(/^export\s+default\s+[A-Za-z_$][\w$]*\s*;?\s*$/gm, '')
    .replace(/^export\s+(?=(?:async\s+)?function\b|const\b|let\b|var\b|class\b)/gm, '');
  if (/^\s*export\s+/m.test(out)) err(path.relative(ROOT, fromAbs) + ' 仍残留 export 语句');
  for (const dep of imports) collect(dep);
  moduleOrder.push({ abs: fromAbs, code: out });
  moduleAbs.set(fromAbs, true);
  visiting.delete(fromAbs);
}

const entryAbs = path.join(ROOT, ENTRY);
if (!exists(ENTRY)) { console.error(ENTRY + ' 不存在'); process.exit(1); }
collect(entryAbs);

// ---------- 资源内联 ----------
const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };
const assetCache = new Map();
const assetRe = /(?:\.\.\/)?assets\/[\w\-./]+\.(?:webp|png|jpg|jpeg|svg|ico)/g;
function inlineAsset(p) {
  const norm = p.replace(/^\.\.\//, '');
  if (assetCache.has(norm)) return assetCache.get(norm);
  const abs = path.join(ROOT, norm);
  if (!fs.existsSync(abs)) { warn('引用的资源不存在：' + norm); assetCache.set(norm, null); return null; }
  const mime = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
  const uri = `data:${mime};base64,` + fs.readFileSync(abs).toString('base64');
  assetCache.set(norm, uri);
  return uri;
}
function inlineAssetsIn(text) {
  let n = 0;
  const out = text.replace(assetRe, (m) => { const uri = inlineAsset(m); if (!uri) return m; n++; return uri; });
  return { out, n };
}

let html = readText('index.html');

// 内联 CSS（处理 url() 引用）
html = html.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, (tag) => {
  const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
  if (!href || /^https?:/.test(href)) return tag;
  const abs = path.join(ROOT, href);
  if (!fs.existsSync(abs)) { err('CSS 不存在：' + href); return ''; }
  let css = fs.readFileSync(abs, 'utf8');
  css = css.replace(/url\((['"]?)([^)'"]+)\1\)/g, (m, q, u) => {
    if (/^data:|^https?:/.test(u)) return m;
    const uri = inlineAsset(u);
    return uri ? `url("${uri}")` : m;
  });
  const { out } = inlineAssetsIn(css);
  return `<style>\n${out}\n</style>`;
});

// 去 manifest / preload / 外部字体（离线版不依赖单独文件）
html = html.replace(/<link\b[^>]*rel=["']manifest["'][^>]*>/gi, '');
html = html.replace(/<link\b[^>]*rel=["']preload["'][^>]*>/gi, (tag) => {
  const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
  return href && !/^assets\//.test(href) ? tag : '';
});

// 掩膜注入
const masks = JSON.parse(readText('data/masks.json'));
const masksScript = `<script>window.__INK_MASKS__=${JSON.stringify(masks)};</script>\n`;

// 入口 module script → 拼接内联
const scriptRe = /<script\b([^>]*)type=["']module["']([^>]*)src=["']([^"']+)["']([^>]*)><\/script>/i;
let m = html.match(scriptRe);
if (!m) {
  const anyRe = /<script\b[^>]*type=["']module["'][^>]*><\/script>/i;
  if (!anyRe.test(html)) err('index.html 里找不到 <script type="module" src="...">');
  else m = html.match(anyRe);
}
if (m && m[3] && path.resolve(ROOT, m[3]) !== entryAbs) warn('入口不是 ' + ENTRY + '，实际：' + m[3]);
const bundle = '// 墨馆 standalone bundle\n' + moduleOrder.map((mo) => `/* ${path.relative(ROOT, mo.abs)} */\n` + mo.code).join('\n\n');
html = html.replace(m ? m[0] : '', `<script type="module">\n${bundle}\n</script>`);
html = html.replace('</head>', masksScript + '</head>');

// 其余资源引用（img/src/srcset 等）内联
const { out: htmlOut, n: inlineCount } = inlineAssetsIn(html);
html = htmlOut;

// 清理 index.html 里对本地文件的 <link rel=icon>（已内联则保留 data:）
// 残留引用检查
const leftovers = [...html.matchAll(/(?:src|href)=["']((?:\.\.\/)?(?:js|css|assets)\/[^"']+)["']/g)].map((x) => x[1]);
if (leftovers.length) err('仍有未内联的本地引用：' + [...new Set(leftovers)].join(', '));

fs.mkdirSync(OUT, { recursive: true });
const outFile = path.join(OUT, 'standalone.html');
fs.writeFileSync(outFile, html, 'utf8');
const kb = (fs.statSync(outFile).size / 1024).toFixed(0);
console.log(`standalone.html 生成：${path.relative(ROOT, outFile)}  ${kb}KB  模块 ${moduleOrder.length} 个 / 内联资源 ${inlineCount} 处 / 掩膜 ${Object.keys(masks).length} 块`);
if (errors.length) { console.error(`构建失败：${errors.length} 个错误`); process.exit(1); }
console.log('PASS');
