/* ===========================================================================
 * ink-engine 自测台的脚本（由 tests/ink-demo.html 以外部 module 引入）
 * 为什么要拆文件：前台/后端用 CSP script-src 'self' 托管时，内联 <script> 会被拦；
 * 外部同源 module 才能在 8790（后端）下正常跑。本文件属于 ink-engine 写作用域 js/ink/。
 * =========================================================================== */

import { createInkEngine } from './engine.js';

const $ = (id) => document.getElementById(id);
const canvas = $('ink');
const paperHint = $('paperHint');
const toastEl = $('toast');

const PALETTE = ['#24201a', '#8a5a35', '#31556f', '#9e3b2e'];
const COLOR_NAMES = ['墨', '赭', '青', '朱'];

let engine = null;
try {
  engine = createInkEngine({
    canvas: canvas,
    masksUrl: '../data/masks.json',
    palette: PALETTE,
    defaultColor: 0,
    onFirstStroke: function(){ paperHint.classList.add('gone'); },
    onChange: function(){ updateStats(); },
    interactive: true,
  });
} catch (err) {
  console.error('[demo] createInkEngine 失败：', err);
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;inset:20px;background:#2a2620;color:#f3c9c0;padding:20px;z-index:99;white-space:pre-wrap';
  box.textContent = 'createInkEngine 失败：\n' + (err && err.stack || err);
  document.body.appendChild(box);
  throw err;
}

let toastTimer = 0;
function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ toastEl.classList.remove('on'); }, 1800);
}

/* ---------- 工具 / 墨色 / 大小 / 旋转 ---------- */

function syncTool(tool){
  document.querySelectorAll('#toolSeg button').forEach(function(btn){
    const on = btn.dataset.tool === tool;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  paperHint.textContent = tool === 'stamp' ? '点一下落墨；按住已落的墨块可提起重摆' : '按住拖一笔，或点一下';
  if (engine.hasInk()) paperHint.classList.add('gone');
}

function syncTone(tone){
  document.querySelectorAll('#toneSeg button').forEach(function(btn){
    const on = btn.dataset.tone === tone;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function syncColor(idx){
  document.querySelectorAll('#swatches .swatch').forEach(function(btn){
    btn.classList.toggle('on', Number(btn.dataset.color) === idx);
  });
  $('colorName').textContent = COLOR_NAMES[idx] || ('色 ' + idx);
}

function syncStampSel(id){
  document.querySelectorAll('#stamps .stamp').forEach(function(btn){
    btn.classList.toggle('on', btn.dataset.id === id);
  });
}

document.querySelectorAll('#toolSeg button').forEach(function(btn){
  btn.addEventListener('click', function(){
    engine.setTool(btn.dataset.tool);
    syncTool(btn.dataset.tool);
    updateStats();
  });
});
document.querySelectorAll('#toneSeg button').forEach(function(btn){
  btn.addEventListener('click', function(){
    engine.setTone(btn.dataset.tone);
    syncTone(btn.dataset.tone);
    updateStats();
  });
});

const palette = engine.getPalette();
$('swatches').innerHTML = palette.map(function(c, i){
  return '<button class="swatch' + (i === 0 ? ' on' : '') + '" data-color="' + i + '"'
    + ' style="background:' + c.css + '" title="' + (COLOR_NAMES[i] || ('色' + i)) + '"'
    + ' aria-label="用色 ' + (COLOR_NAMES[i] || i) + '"></button>';
}).join('');
document.querySelectorAll('#swatches .swatch').forEach(function(btn){
  btn.addEventListener('click', function(){
    const i = Number(btn.dataset.color);
    engine.setColor(i);
    syncColor(i);
    // 换墨色后把墨块缩略图重刷成当前色（墨块的着色就是 cache key 的一部分）
    renderStamps();
    updateStats();
  });
});

$('size').addEventListener('input', function(){
  engine.setSize(Number(this.value));
  $('sizeOut').textContent = '×' + Number(this.value).toFixed(2);
  updateStats();
});
$('rot').addEventListener('input', function(){
  engine.setRotation(Number(this.value));
  $('rotOut').textContent = Math.round(Number(this.value)) + '°';
  updateStats();
});

/* ---------- 墨块列表（掩膜就绪后才有） ---------- */

const GROUP_NAMES = ['远景', '中景', '点缀'];

function renderStamps(){
  if (!engine.isReady()) return;
  const list = engine.getStamps();
  const errs = engine.getMaskErrors();
  $('stampCount').textContent = list.length ? (list.length + ' 块') : '未载入';
  if (!list.length){
    $('stamps').innerHTML = '<p class="note">掩膜没载入：' + (errs.join('、') || '未知原因')
      + '。自由笔不受影响；请用 http 方式打开本页（file:// 下 fetch 会被拦）。</p>';
    return;
  }
  let html = '';
  let lastG = -1;
  for (const item of list){
    if (item.g !== lastG){
      lastG = item.g;
      html += '<div class="stamp-g">' + (GROUP_NAMES[item.g] || ('第' + item.g + '组')) + '</div>';
    }
    const thumb = engine.getStampThumb(item.id, { width: 96 });
    html += '<button class="stamp" data-id="' + item.id + '" title="' + item.label + '">'
      + (thumb ? '<img src="' + thumb + '" alt="">' : '')
      + '<span>' + item.label + '</span></button>';
  }
  $('stamps').innerHTML = html;
  document.querySelectorAll('#stamps .stamp').forEach(function(btn){
    btn.addEventListener('click', function(){
      engine.setTool('stamp');
      engine.setStamp(btn.dataset.id);
      syncTool('stamp');
      syncStampSel(btn.dataset.id);
      updateStats();
    });
  });
  syncStampSel(engine.getSettings().stampId);
}

/* ---------- 读数 ---------- */

function row(k, v){ return '<dt>' + k + '</dt><dd>' + v + '</dd>'; }

function updateStats(){
  const st = engine.stats();
  const pf = engine.getPerf();
  const s = engine.getSettings();
  const cov = (st.inkCoverage * 100).toFixed(1) + '%';
  $('stats').innerHTML =
    row('工具', s.tool === 'stamp' ? '墨块' : '笔') +
    row('浓淡', { light: '淡', medium: '中', dark: '浓' }[s.tone] || s.tone) +
    row('大小', '×' + s.size.toFixed(2) + (s.tool === 'stamp' ? ' · ' + Math.round(s.rotation) + '°' : '')) +
    row('落墨', st.strokes + ' 笔 · ' + st.stamps + ' 块') +
    row('用时', (st.ms / 1000).toFixed(1) + ' s') +
    row('墨覆盖', cov) +
    row('可撤', pf.undoDepth + ' 步 · op ' + pf.opCount) +
    row('画布', pf.cssW + '×' + pf.cssH + ' · dpr ' + pf.dpr.toFixed(2) + ' · ' + pf.deviceW + '×' + pf.deviceH + 'px') +
    row('首帧', pf.firstFrameMs + ' ms') +
    row('落笔', 'last ' + pf.lastStrokeMs + ' ms · max ' + pf.maxStrokeMs + ' ms') +
    row('墨块渲染', pf.lastStampMs + ' ms · cache ' + pf.stampCache) +
    row('撤销', pf.undoMs + ' ms');

  $('pillReady').textContent = engine.isReady()
    ? ('就绪 · ' + engine.getStamps().length + ' 块')
    : '掩膜载入中';
  $('pillReady').className = 'pill ' + (engine.isReady() ? 'ok' : '');
  $('pillDpr').textContent = 'dpr ' + pf.dpr.toFixed(2) + ' · D ' + (pf.dpr ? '' : '');
  $('pillPerf').textContent = '首帧 ' + pf.firstFrameMs + ' ms';
  if (engine.isReady() && engine.getMaskErrors().length){
    $('pillReady').className = 'pill bad';
    $('pillReady').textContent = '掩膜部分失败：' + engine.getMaskErrors().join(',');
  }
}

setInterval(updateStats, 500);

/* ---------- 按钮 ---------- */

$('btnUndo').addEventListener('click', function(){
  const ok = engine.undo();
  updateStats();
  toast(ok ? '撤了最近一笔' : '没有可撤的墨');
});
$('btnClear').addEventListener('click', function(){
  engine.clear();
  paperHint.classList.remove('gone');
  updateStats();
  toast('纸重新铺好了');
});
$('btnExport').addEventListener('click', function(){
  const url = engine.toDataURL('image/png');
  if (!url || url.indexOf('data:image') !== 0){ toast('导出失败'); return; }
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ink-engine-demo.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast('已导出透明底 PNG');
});
$('btnSample').addEventListener('click', function(){ drawSample(); });

/* ---------- 合成 pointer 事件（示例构图 / 自测共用） ---------- */

function fire(type, nx, ny, pointerId){
  const r = canvas.getBoundingClientRect();
  const ev = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: r.left + nx * r.width,
    clientY: r.top + ny * r.height,
    pointerId: pointerId || 11,
    pointerType: 'mouse',
    isPrimary: true,
    button: type === 'pointermove' ? -1 : 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
  });
  canvas.dispatchEvent(ev);
  return ev;
}

function tapAt(nx, ny, pointerId){
  fire('pointerdown', nx, ny, pointerId);
  fire('pointerup', nx, ny, pointerId);
}

function dragPath(points, pointerId){
  const pid = pointerId || 11;
  fire('pointerdown', points[0][0], points[0][1], pid);
  for (let i = 1; i < points.length; i++) fire('pointermove', points[i][0], points[i][1], pid);
  fire('pointerup', points[points.length - 1][0], points[points.length - 1][1], pid);
}

function brushPath(points, tone, size){
  engine.setTool('brush');
  engine.setTone(tone);
  engine.setSize(size);
  syncTool('brush');
  syncTone(tone);
  $('size').value = String(size);
  $('sizeOut').textContent = '×' + size.toFixed(2);
  dragPath(points);
}

function stampAt(id, x, y, rot, size){
  engine.setTool('stamp');
  engine.setStamp(id);
  engine.setRotation(rot || 0);
  engine.setSize(size == null ? 1 : size);
  syncTool('stamp');
  syncStampSel(id);
  tapAt(x, y);
}

/* 一条弧：从 (x0,y0) 到 (x1,y1)，正弦拱起 rise —— 墨是要"一笔过去"的，不能画成折线 */
function arcPath(x0, y0, x1, y1, rise, n){
  const out = [];
  for (let i = 0; i <= n; i++){
    const t = i / n;
    out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - Math.sin(Math.PI * t) * rise]);
  }
  return out;
}

/* 示例构图：远山 + 坡脚 + 柳 + 茅屋 + 钓翁 + 水纹，供 QA 截图看"笔"与"墨块"是否协调 */
function drawSample(){
  engine.clear();
  engine.setColor(0);
  syncColor(0);
  /* 远山：淡墨两道长弧 */
  brushPath(arcPath(0.06, 0.60, 0.56, 0.55, 0.10, 14), 'light', 1.25);
  brushPath(arcPath(0.50, 0.58, 0.96, 0.52, 0.07, 12), 'light', 1.1);
  /* 中景坡脚：中墨一道缓弧 */
  brushPath(arcPath(0.10, 0.72, 0.92, 0.70, 0.035, 16), 'medium', 0.95);
  /* 水面：几笔短横的淡墨 */
  brushPath([[0.52, 0.84], [0.60, 0.835], [0.68, 0.84], [0.76, 0.835]], 'light', 0.8);
  brushPath([[0.58, 0.88], [0.66, 0.875], [0.74, 0.88]], 'medium', 0.7);
  /* 苔点：浓墨点几处（点落＝一颗墨点） */
  engine.setTool('brush');
  engine.setTone('dark');
  engine.setSize(0.6);
  syncTool('brush');
  syncTone('dark');
  [[0.24, 0.735], [0.29, 0.75], [0.35, 0.74], [0.47, 0.76], [0.86, 0.72]].forEach(function(pt){ tapAt(pt[0], pt[1]); });
  /* 墨块：土坡 / 柳 / 茅屋 / 钓翁 / 煎茶 / 水纹（水纹换青，给远景一小块色） */
  stampAt('t-liu', 0.76, 0.64, 0, 0.95);
  stampAt('h-maowu', 0.50, 0.72, 0, 0.8);
  stampAt('g-tupo', 0.16, 0.81, 0, 1.0);
  stampAt('f-yuweng', 0.40, 0.85, 0, 0.7);
  stampAt('f-zaocha', 0.60, 0.82, 0, 0.62);
  engine.setColor(2);
  syncColor(2);
  stampAt('w-wave', 0.52, 0.88, 0, 1.1);
  engine.setColor(0);
  syncColor(0);
  /* 收尾：近景泥岸一笔浓墨（大笔，能看出笔道与飞白） */
  brushPath(arcPath(0.04, 0.965, 0.44, 0.945, 0.018, 18), 'dark', 1.7);
  brushPath(arcPath(0.58, 0.945, 0.82, 0.925, 0.012, 10), 'medium', 0.8);
  engine.setTone('medium');
  syncTone('medium');
  updateStats();
  toast('示例构图已落下（可用撤销逐步查看历史）');
}

/* ---------- 启动 ---------- */

engine.ready.then(function(){
  renderStamps();
  syncTool(engine.getSettings().tool);
  updateStats();
  const params = new URLSearchParams(location.search);
  if (params.has('draw')){
    setTimeout(function(){ drawSample(); }, 120);
  }
  if (params.has('selftest')){
    setTimeout(function(){ runSelftest(); }, 80);
  }
});
/* 掩膜失败时 ready 也会 resolve（只记 maskErrors），这里兜底再刷一次 */
setTimeout(function(){ renderStamps(); updateStats(); }, 4000);

/* ---------- 自动自测（?selftest=1）：结果写 #selftest 与 document.title ---------- */

async function runSelftest(){
  const out = $('selftest');
  out.hidden = false;
  const lines = [];
  const results = [];
  const tStart = performance.now();

  function check(name, fn){
    let ok = false;
    let detail = '';
    try {
      const r = fn();
      if (r === true){ ok = true; }
      else if (typeof r === 'string'){ ok = true; detail = r; }
      else { ok = !!r; if (!ok) detail = '返回值 ' + String(r); }
    } catch (e){
      ok = false;
      detail = (e && e.message) || String(e);
    }
    results.push({ name: name, ok: ok, detail: detail });
    lines.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (detail ? ' — ' + detail : ''));
    out.textContent = lines.join('\n');
    return ok;
  }

  function render(){
    const fail = results.filter(function(r){ return !r.ok; }).length;
    out.textContent = lines.join('\n') + '\n\n'
      + (results.length - fail) + ' pass / ' + fail + ' fail · '
      + (performance.now() - tStart).toFixed(0) + 'ms';
    document.title = 'INK-DEMO-SELFTEST:' + (fail ? 'FAIL' : 'PASS');
    window.__INK_DEMO_RESULT__ = { pass: results.length - fail, fail: fail, results: results };
    console.log('[selftest] ' + document.title, window.__INK_DEMO_RESULT__);
  }

  out.textContent = 'running…';

  /* 0. 契约方法齐全 */
  const METHODS = ['setTool', 'setTone', 'setColor', 'setSize', 'setRotation', 'setStamp',
    'undo', 'clear', 'hasInk', 'stats', 'toDataURL', 'setInteractive', 'resize', 'destroy'];
  check('契约方法全部存在', function(){
    const miss = METHODS.filter(function(k){ return typeof engine[k] !== 'function'; });
    return miss.length ? '缺：' + miss.join(',') : true;
  });

  /* 1. 掩膜 */
  await Promise.race([engine.ready, new Promise(function(res){ setTimeout(res, 8000); })]);
  check('掩膜 ready', function(){ return engine.isReady() ? true : 'ready 超时'; });
  check('墨块 = 11 块', function(){
    const n = engine.getStamps().length;
    if (n === 11) return true;
    return '实际 ' + n + ' 块'
      + (engine.getMaskErrors().length ? ' · errors=' + engine.getMaskErrors().join(',') : '');
  });
  check('墨块缩略图是 PNG dataURL', function(){
    return engine.getStampThumb('w-wave', { width: 96 }).indexOf('data:image/png') === 0;
  });
  check('stampIds 可选块', function(){
    const ids = engine.stampIds;
    if (!ids.length) return '没有墨块 id';
    engine.setTool('stamp');
    engine.setStamp(ids[0]);
    return ids.length + ' 个 id';
  });

  /* 2. 点按落墨 + 撤销 */
  engine.clear();
  engine.setTool('stamp');
  engine.setStamp('w-wave');
  engine.setSize(1.3);
  engine.setRotation(25);
  tapAt(0.30, 0.35);
  check('点按落一块墨', function(){
    const n = engine.stats().stamps;
    return n === 1 ? true : ('stamps=' + n);
  });
  check('hasInk = true', function(){ return engine.hasInk(); });
  engine.undo();
  check('撤销后无墨', function(){ return engine.stats().stamps === 0 && !engine.hasInk(); });

  /* 3. 自由笔：拖一笔 + 点落 */
  engine.setTool('brush');
  engine.setTone('dark');
  engine.setSize(1.2);
  dragPath([[0.30, 0.62], [0.36, 0.58], [0.42, 0.61], [0.48, 0.56], [0.54, 0.60]]);
  check('拖一笔 strokes=1', function(){ return engine.stats().strokes === 1; });
  check('落笔响应 < 50ms', function(){
    const pf = engine.getPerf();
    const v = Math.max(pf.maxStrokeMs, pf.lastStrokeMs);
    return v < 50 ? (v + ' ms') : ('超预算 ' + v + ' ms');
  });
  check('墨覆盖率 > 0', function(){ return engine.stats().inkCoverage > 0; });
  tapAt(0.62, 0.40);
  check('点落也算一笔', function(){ return engine.stats().strokes === 2; });
  engine.undo();
  check('undo 回退到 1 笔', function(){ return engine.stats().strokes === 1; });

  /* 4. 墨块 + 笔混落，撤销只撤最近一次 */
  engine.setTool('stamp');
  engine.setStamp('h-maowu');
  engine.setSize(1.0);
  tapAt(0.55, 0.45);
  check('混合落墨 1 块 + 1 笔', function(){
    const st = engine.stats();
    return st.stamps === 1 && st.strokes === 1;
  });
  engine.undo();
  check('撤销只撤墨块', function(){
    const st = engine.stats();
    return st.stamps === 0 && st.strokes === 1;
  });

  /* 5. 提起重摆 / 取消重摆 */
  engine.setTool('stamp');
  engine.setStamp('h-maowu');
  tapAt(0.55, 0.45);
  const beforeLift = engine.toDataURL('image/png');
  const rect = canvas.getBoundingClientRect();
  fire('pointerdown', 0.55, 0.45, 21);
  fire('pointermove', 0.55 + 40 / rect.width, 0.45, 21);
  fire('pointermove', 0.55 + 80 / rect.width, 0.45, 21);
  fire('pointerup', 0.55 + 80 / rect.width, 0.45, 21);
  const afterLift = engine.toDataURL('image/png');
  check('提起重摆不增块数', function(){ return engine.stats().stamps === 1; });
  check('提起重摆换了位置', function(){ return beforeLift !== afterLift; });

  const opCount0 = engine.getPerf().opCount;
  tapAt(0.55 + 80 / rect.width, 0.45);
  check('按下不动=取消重摆（不进历史）', function(){
    const d = engine.getPerf().opCount - opCount0;
    return d === 0 ? true : ('opCount 变化 ' + d);
  });

  /* 6. 导出 / resize */
  check('toDataURL 是 PNG dataURL', function(){
    const u = engine.toDataURL('image/png');
    return u.indexOf('data:image/png;base64,') === 0 && u.length > 2000 ? true : ('len=' + u.length);
  });
  const stBefore = engine.stats();
  engine.resize();
  const stAfter = engine.stats();
  check('resize 后墨还在', function(){
    return stAfter.strokes === stBefore.strokes && stAfter.stamps === stBefore.stamps;
  });
  check('画布有设备像素', function(){
    const pf = engine.getPerf();
    return pf.deviceW > 0 && pf.deviceH > 0;
  });

  /* 7. 历史 ≥ 50 */
  engine.clear();
  engine.setTool('stamp');
  engine.setStamp('w-wave');
  engine.setSize(0.6);
  for (let i = 0; i < 55; i++){
    tapAt(0.08 + (i % 11) * 0.075, 0.18 + Math.floor(i / 11) * 0.08);
  }
  check('历史可撤 ≥ 50', function(){
    const d = engine.getPerf().undoDepth;
    return d >= 50 ? (d + ' 步') : ('只有 ' + d + ' 步');
  });
  let undone = 0;
  for (let i = 0; i < 3; i++) if (engine.undo()) undone++;
  check('连续撤销 3 次', function(){ return undone === 3 ? true : ('只撤了 ' + undone); });
  engine.undo();

  /* 8. 交互开关 */
  engine.setInteractive(false);
  const lockedStamps = engine.stats().stamps;
  tapAt(0.92, 0.9);
  check('setInteractive(false) 后不落墨', function(){
    return engine.stats().stamps === lockedStamps;
  });
  engine.setInteractive(true);
  tapAt(0.92, 0.9);
  check('setInteractive(true) 恢复', function(){
    return engine.stats().stamps === lockedStamps + 1;
  });

  /* 9. clear / stats 归零 */
  engine.clear();
  check('clear 后 hasInk=false', function(){ return !engine.hasInk(); });
  check('clear 后 stats 归零', function(){
    const st = engine.stats();
    return st.strokes === 0 && st.stamps === 0 && st.inkCoverage === 0;
  });

  /* 10. 性能读数 */
  const pf = engine.getPerf();
  lines.push('');
  lines.push('性能：init ' + pf.initMs + 'ms · masks ' + pf.masksReadyMs + 'ms · 首帧 ' + pf.firstFrameMs + 'ms');
  lines.push('      落笔 last ' + pf.lastStrokeMs + 'ms / max ' + pf.maxStrokeMs
    + 'ms · 墨块渲染 ' + pf.lastStampMs + 'ms');
  lines.push('      画布 ' + pf.cssW + '×' + pf.cssH + ' @' + pf.dpr.toFixed(2)
    + ' → ' + pf.deviceW + '×' + pf.deviceH + ' px');
  render();
}

/* 自测入口挂到 window，方便 QA/Playwright 直接调：await window.runInkSelftest() */
window.runInkSelftest = runSelftest;
window.__inkDemo = {
  engine: engine,
  createInkEngine: createInkEngine,
  drawSample: drawSample,
  fire: fire,
  tapAt: tapAt,
  dragPath: dragPath,
};