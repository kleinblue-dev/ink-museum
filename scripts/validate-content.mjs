// 内容纪律 + 资产门禁。用法：node scripts/validate-content.mjs [--allow-missing-assets]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowMissing = process.argv.includes('--allow-missing-assets');
const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const chars = (s) => [...String(s ?? '')].length;

const REQUIRED_FILES = ['index.html', 'js/main.js', 'css/style.css', 'content/content.js', 'data/masks.json'];

let CONTENT;
try {
  ({ CONTENT } = await import(pathToFileURL(path.join(ROOT, 'content/content.js')).href));
} catch (e) {
  console.error('无法 import content/content.js:', e.message);
  process.exit(1);
}
if (!CONTENT) { console.error('content/content.js 没有导出 CONTENT'); process.exit(1); }

// ---------- 结构 ----------
const need = (obj, pathStr, test = (v) => v !== undefined && v !== null && v !== '') => {
  const parts = pathStr.split('.');
  let cur = obj;
  for (const p of parts) { if (cur == null || typeof cur !== 'object') { cur = undefined; break; } cur = cur[p]; }
  if (!test(cur)) err(`缺少/非法字段 content.${pathStr}`);
  return cur;
};
const strMax = (v, n, label) => { if (typeof v !== 'string' || chars(v) > n) err(`${label} 应为 ≤${n} 字的中文字符串，实际: ${JSON.stringify(v)}`); };

need(CONTENT, 'version'); if (!/^\d+\.\d+\.\d+$/.test(CONTENT.version || '')) err('content.version 必须是 semver');
need(CONTENT, 'museum.title'); strMax(CONTENT.museum?.title, 4, 'museum.title');
strMax(CONTENT.museum?.subtitle, 20, 'museum.subtitle');
strMax(CONTENT.museum?.kicker, 16, 'museum.kicker');
['enter', 'museumLabel', 'aboutLabel', 'soundOn', 'soundOff'].forEach((k) => need(CONTENT, 'museum.' + k));

need(CONTENT, 'ethics.short'); strMax(CONTENT.ethics.short, 30, 'ethics.short');
need(CONTENT, 'ethics.long'); strMax(CONTENT.ethics.long, 200, 'ethics.long');
need(CONTENT, 'ethics.privacy'); strMax(CONTENT.ethics.privacy, 200, 'ethics.privacy');
need(CONTENT, 'ethics.credits'); strMax(CONTENT.ethics.credits, 200, 'ethics.credits');

need(CONTENT, 'entry.bg.wide'); need(CONTENT, 'entry.bg.tall');
need(CONTENT, 'pre.items'); if (!Array.isArray(CONTENT.pre?.items) || CONTENT.pre.items.length !== 3) err('pre.items 必须是 3 项');
need(CONTENT, 'pre.next'); strMax(CONTENT.pre?.next, 6, 'pre.next');
need(CONTENT, 'post.moods'); if (!Array.isArray(CONTENT.post?.moods) || CONTENT.post.moods.length !== 4) err('post.moods 必须是 4 项');
need(CONTENT, 'post.moodLabel'); strMax(CONTENT.post?.moodLabel, 14, 'post.moodLabel');
need(CONTENT, 'line.replies'); if (!Array.isArray(CONTENT.line?.replies) || CONTENT.line.replies.length !== 3) err('line.replies 必须是 3 项');
need(CONTENT, 'ink.hint'); strMax(CONTENT.ink?.hint, 14, 'ink.hint');
['undo', 'clear', 'brush', 'stamp', 'tone', 'size', 'rotate'].forEach((k) => need(CONTENT, 'ui.' + k));

if (!Array.isArray(CONTENT.scenes) || CONTENT.scenes.length !== 4) err('scenes 必须是 4 个展厅');
const ids = new Set();
const REQUIRED_WORKS = { spring: '郭熙', water: '马远', bamboo: '文同', pavilion: '倪瓒' };
for (const [i, sc] of (CONTENT.scenes || []).entries()) {
  const at = `scenes[${i}]`;
  ['id', 'name', 'work.title', 'work.artist', 'work.dynasty', 'bg.wide', 'bg.tall', 'bg.thumb', 'bg.position'].forEach((k) => need(sc, k, (v) => v !== undefined && v !== null && v !== ''));
  if (ids.has(sc.id)) err(`${at}.id 重复: ${sc.id}`); ids.add(sc.id);
  strMax(sc.name, 4, `${at}.name`);
  if (chars(sc.work?.title) > 8) err(`${at}.work.title 过长`);
  if (chars(sc.work?.artist) > 4) err(`${at}.work.artist 过长`);
  if (!Array.isArray(sc.opening) || sc.opening.length < 1 || sc.opening.length > 2) err(`${at}.opening 需 1–2 句`);
  if (!Array.isArray(sc.closing) || sc.closing.length < 1 || sc.closing.length > 2) err(`${at}.closing 需 1–2 句`);
  (sc.opening || []).concat(sc.closing || []).forEach((ln, j) => { if (chars(ln) > 18) err(`${at} 第${j + 1}句过长（>18字）: ${ln}`); });
  if (!Array.isArray(sc.ink?.palette) || sc.ink.palette.length < 2 || sc.ink.palette.length > 4) err(`${at}.ink.palette 需 2–4 色`);
  (sc.ink?.palette || []).forEach((hex) => { if (!/^#[0-9a-fA-F]{6}$/.test(hex)) err(`${at}.ink.palette 非法色值: ${hex}`); });
  if (typeof sc.ink?.defaultColor !== 'number' || sc.ink.defaultColor < 0 || sc.ink.defaultColor >= (sc.ink.palette?.length || 0)) err(`${at}.ink.defaultColor 越界`);
}
if (ids.size !== 4) err('scene id 必须覆盖 spring/water/bamboo/pavilion');
for (const [id, artist] of Object.entries(REQUIRED_WORKS)) {
  const sc = (CONTENT.scenes || []).find((s) => s.id === id);
  if (sc && sc.work?.artist !== artist) warn(`scenes.${id} 的画家是 ${sc.work?.artist}，预期 ${artist}（替代作品需在 CREDITS 说明）`);
}

// ---------- 文案纪律 ----------
const forb = ['治疗', '疗愈', '治愈', '疗效', '包治', '抑郁症', '焦虑症', '疗效显著'];
const serialized = JSON.stringify(CONTENT);
for (const w of forb) if (serialized.includes(w)) err(`文案含违禁词「${w}」（不能宣称医疗效果）`);

// ---------- 资产 ----------
const assetPaths = [];
for (const sc of CONTENT.scenes || []) for (const k of ['wide', 'tall', 'thumb']) assetPaths.push(sc.bg[k]);
assetPaths.push(CONTENT.entry?.bg?.wide, CONTENT.entry?.bg?.tall,
  'assets/paper-tile.webp', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png');
const BUDGET = { wide: 220 * 1024, tall: 180 * 1024, thumb: 60 * 1024, 'paper-tile': 40 * 1024, 'icon-192': 120 * 1024, 'icon-512': 300 * 1024 };
const missing = [];
for (const p of assetPaths) {
  if (!p) continue;
  if (!exists(p)) { missing.push(p); continue; }
  const size = fs.statSync(path.join(ROOT, p)).size;
  const kind = /-wide\.webp$/.test(p) ? 'wide' : /-tall\.webp$/.test(p) ? 'tall' : /-thumb\.webp$/.test(p) ? 'thumb' : /paper-tile/.test(p) ? 'paper-tile' : /icon-192/.test(p) ? 'icon-192' : /icon-512/.test(p) ? 'icon-512' : null;
  if (kind && size > BUDGET[kind]) err(`${p} 超预算：${(size / 1024).toFixed(0)}KB > ${(BUDGET[kind] / 1024).toFixed(0)}KB`);
  if (size < 4 * 1024) warn(`${p} 只有 ${(size / 1024).toFixed(1)}KB，可能不是有效图片`);
}
if (missing.length) {
  const msg = `资产缺失 ${missing.length} 个：` + missing.join(', ');
  if (allowMissing) warn(msg + '（--allow-missing-assets 放行）'); else err(msg);
}
for (const f of REQUIRED_FILES) if (!exists(f) && !f.startsWith('css/') && !f.startsWith('js/')) err(`缺文件：${f}`);

// ---------- 输出 ----------
const fmt = (kb) => (kb / 1024).toFixed(0) + 'KB';
console.log('墨馆 · 内容与资产校验');
console.log(`  version=${CONTENT.version}  scenes=${(CONTENT.scenes || []).map((s) => s.id).join('/')}`);
for (const p of assetPaths.filter(Boolean)) {
  if (!exists(p)) continue;
  console.log(`  ${fmt(fs.statSync(path.join(ROOT, p)).size).padStart(6)}  ${p}`);
}
if (warns.length) { console.log('\nWARN'); warns.forEach((w) => console.log('  - ' + w)); }
if (errors.length) { console.log('\nERROR'); errors.forEach((e) => console.log('  - ' + e)); process.exit(1); }
console.log(`\nPASS 0 error / ${warns.length} warn`);
