// 源文件编码/乱码扫描：UTF-8 无 BOM、无常见 GBK 误读序列、无 U+FFFD。
// 用法：node scripts/check-encoding.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '_qa-artifacts', 'dist', 'data', '_cache', 'images', '__pycache__']);
const TEXT_EXT = new Set(['.html', '.css', '.js', '.mjs', '.json', '.md', '.ps1', '.txt', '.webmanifest', '.svg']);
// 典型「UTF-8 被当 GBK 解码」双字组合；以及半角替换符
const MOJIBAKE = ['锛','鐨','涓','庝','鏄','缂','寮','銆','鎺','鍔','璇','鐢','绋','娓','澹','顦','澧','钀','Ã¤','Ã©','â€'];
const errors = [];
const warns = [];
const files = [];
(function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) { if (!SKIP_DIRS.has(ent.name)) walk(path.join(dir, ent.name)); continue; }
    if (TEXT_EXT.has(path.extname(ent.name).toLowerCase())) files.push(path.join(dir, ent.name));
  }
})(ROOT);
for (const abs of files) {
  const rel = path.relative(ROOT, abs);
  if (rel === path.relative(ROOT, fileURLToPath(import.meta.url))) continue;
  const buf = fs.readFileSync(abs);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { errors.push(`${rel}: 不是合法 UTF-8（可能被 GBK 写入）`); continue; }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    if (/\.(js|mjs|css|html)$/i.test(rel)) warns.push(`${rel}: 带 UTF-8 BOM（JS 可能受 shebang/拼接影响）`);
  }
  if (text.includes('\uFFFD')) errors.push(`${rel}: 含 U+FFFD 替换符（编码损坏）`);
  const hits = MOJIBAKE.filter((m) => text.includes(m));
  if (hits.length) errors.push(`${rel}: 疑似 GBK 乱码（命中 ${hits.join(' ')}）`);
}
console.log(`扫描 ${files.length} 个文本文件（跳过 node_modules/_qa-artifacts/dist/二进制）`);
if (warns.length) { console.log('WARN'); warns.forEach((w) => console.log('  - ' + w)); }
if (errors.length) { console.log('ERROR'); errors.forEach((e) => console.log('  - ' + e)); process.exit(1); }
console.log('PASS 编码检查通过');
