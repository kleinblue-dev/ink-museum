/**
 * 墨馆 · 落墨引擎（ink-engine） v1
 * ===========================================================================
 * 把两个原型的绘画核心合成一个可复用的透明画布引擎：
 *   · 墨块（stamp） ← 墨心 _recon/ink-mind：
 *       masks.json 的 11 张芥子园线稿 alpha → renderPieceMask 的四层管线
 *       （湿晕 24 遍 → 主体 12~24 遍 → 骨 1 遍 → 飞白），D=2 固定倍率改为按 DPR 自适应。
 *   · 自由笔（brush） ← 墨间 _recon/mojian：
 *       settleDab 的"一团湿点"改成三张笔尖精灵（湿晕 / 笔芯 / 飞白），支持拖拽与点落。
 *   · 历史、归一化坐标、DPR、pointer events、调色板、性能读数 = 新增引擎层。
 *
 * 硬契约：docs/SPEC.md §4
 *   createInkEngine({canvas, masksUrl, palette, defaultColor, onFirstStroke, onChange, interactive})
 *   → {setTool,setTone,setColor,setSize,setRotation,setStamp,undo,clear,hasInk,
 *      stats,toDataURL,setInteractive,resize,destroy}
 *
 * 打包约定（Lead 硬约束）：
 *   · 本文件只有一个具名导出 createInkEngine；无 default、无 export{} 列表、
 *     无动态 import、无 import.meta、无外部 import —— 可被 build-standalone 直接拼接。
 *   · 纯逻辑（历史栈/坐标/调色板等）的测试出口挂在 createInkEngine.pure 上。
 *
 * 设计要点
 *   1. 画布透明，只画墨；纸纹/背景由前台提供。
 *   2. 每次落墨记成一条操作（op）入历史：撤销 = 重放，不用快照，内存稳定。
 *      op 内坐标归一化 0..1、半径归一化到画布宽，resize 后重放不丢墨，可撤 ≥50 步。
 *   3. 长会话把不可撤的老 op 烘焙进底图（rebuildBase），撤销始终只重放"底图+最近60条"。
 *   4. 墨块按（块 id + 墨色号 + 浓淡档）缓存离屏位图（LRU）；自由笔用预生成笔尖精灵，
 *      落笔路径里不创建渐变/滤镜，稳定在 1 帧内。
 *   5. 着色重量补偿沿用墨心的 f（赭/藤黄在纸上比墨轻，抬 alpha 才像蘸饱）；色值全部
 *      来自 content 的 palette，不写死"墨色"。
 *
 * 扩展方法（契约之外，demo/前台可选；契约要求的方法一个不少）：
 *   engine.ready                Promise，掩膜加载完成
 *   engine.isReady()            是否已有墨块可用
 *   engine.stampIds             当前可用墨块 id 数组（getStamps 的简版）
 *   engine.getStamps()          [{id,label,g,z,w,h}]
 *   engine.getPalette()         [{index,css,rgb,f}]
 *   engine.getStampThumb(id,o)  墨块透明缩略图 dataURL（工具条/demo 用）
 *   engine.getSettings()        {tool,tone,color,size,rotation,stampId,interactive}
 *   engine.getPerf()            性能读数（首帧/掩膜/落笔/撤销耗时）
 *   engine.getMaskErrors()      解码失败的掩膜 id（空=全好）
 */

/* ============================================================
 * 一、纯逻辑（不碰 DOM；node --test 通过 createInkEngine.pure 取用）
 * ============================================================ */

function clamp(v, lo, hi){ return v < lo ? lo : v > hi ? hi : v; }

var HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function hexToRgb(hex){
  if (typeof hex !== 'string') return null;
  var m = HEX_RE.exec(hex.trim());
  if (!m) return null;
  var s = m[1];
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

function rgbCss(rgb, alpha){
  var a = alpha == null ? 1 : clamp(alpha, 0, 1);
  return 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + a + ')';
}

/* sRGB 相对亮度。只用来做"色彩视觉重量"的近似，不做任何解释性判断。 */
function rgbLum(rgb){
  function ch(c){
    c = c / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return 0.2126 * ch(rgb.r) + 0.7152 * ch(rgb.g) + 0.0722 * ch(rgb.b);
}

/* 视觉重量补偿（墨心 f 的近似）：
 * 赭石/藤黄在纸上比墨"轻"，同样的 alpha 会显得没蘸饱；按亮度抬一点，
 * 只乘在渲染的 globalAlpha 上，不改颜色本身。墨心实测值：墨1.00 / 赭1.30 /
 * 花青1.04 / 藤黄1.62 / 朱砂1.14，这条公式与它们误差 ±0.1 内。 */
function colorWeight(rgb){
  if (!rgb) return 1;
  return clamp(1 + (rgbLum(rgb) - 0.02) * 2.2, 0.9, 1.75);
}

/* 缺省 palette：墨 / 赭石 / 花青 / 朱砂（前台会传 content 里每场景的 palette） */
var DEFAULT_PALETTE = ['#1a1a18', '#a35a2e', '#31556f', '#a83a2c'];

function makePaletteColor(hex){
  var rgb = hexToRgb(hex);
  if (!rgb) return null;
  return { css: rgbCss(rgb, 1), rgb: rgb, f: colorWeight(rgb) };
}

function normalizePalette(list){
  var out = [];
  var src = Array.isArray(list) ? list : [];
  for (var i = 0; i < src.length; i++){
    var item = src[i];
    var c = null;
    if (typeof item === 'string') c = makePaletteColor(item);
    else if (item && typeof item.css === 'string') c = makePaletteColor(item.css);
    if (c) out.push(c);
  }
  if (!out.length){
    for (var k = 0; k < DEFAULT_PALETTE.length; k++){
      var d = makePaletteColor(DEFAULT_PALETTE[k]);
      if (d) out.push(d);
    }
  }
  return out;
}

/* 三档墨色。ink 同时用于墨块渲染浓淡；alpha/radius 给自由笔；dry 控制飞白量。 */
var TONES = {
  light:  { ink: 0.34, alpha: 0.62, radius: 0.88, dry: 0.05 },
  medium: { ink: 0.62, alpha: 1.00, radius: 1.05, dry: 0.16 },
  dark:   { ink: 0.92, alpha: 1.42, radius: 1.18, dry: 0.42 },
};

function normalizeTone(tone){
  return Object.prototype.hasOwnProperty.call(TONES, tone) ? tone : 'medium';
}

function toneParams(tone){ return TONES[normalizeTone(tone)]; }

function normalizeSize(v){
  var n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return clamp(n, 0.5, 2);
}

function normalizeRotation(deg){
  var d = Number(deg);
  if (!Number.isFinite(d)) return 0;
  return ((d % 360) + 360) % 360;
}

function normalizeColorIndex(i, paletteLength, fallback){
  var len = Math.max(1, Math.floor(paletteLength) || 1);
  var fb = Number.isFinite(fallback) ? Math.floor(fallback) : 0;
  var n = Number(i);
  if (!Number.isFinite(n)) return clamp(fb, 0, len - 1);
  return clamp(Math.floor(n), 0, len - 1);
}
/* 屏幕坐标 → 画布归一化坐标（0..1，越界夹住）。
 * 已处理 pointer 事件的 clientX/Y 与 getBoundingClientRect 的偏移，
 * 也处理 CSS 尺寸 ≠ 设备像素的情况（引擎内部一律用 CSS 坐标，ctx 已按 dpr 缩放）。*/
function coordsToNormalized(clientX, clientY, rect){
  var r = rect || { left: 0, top: 0, width: 1, height: 1 };
  var w = r.width > 0 ? r.width : 1;
  var h = r.height > 0 ? r.height : 1;
  return {
    x: clamp((Number(clientX) - (r.left || 0)) / w, 0, 1),
    y: clamp((Number(clientY) - (r.top || 0)) / h, 0, 1),
  };
}

/* 一段位移要插几个落笔点：间距按笔尖半径给，避免快速拖动时断成一串点。
 * 返回的是「从 from 到 to 的中间点」，不含 from、含 to。*/
function brushSteps(fromX, fromY, toX, toY, spacing){
  var dx = toX - fromX;
  var dy = toY - fromY;
  var dist = Math.sqrt(dx * dx + dy * dy);
  var sp = Math.max(1e-6, Number(spacing) || 1);
  var n = Math.max(1, Math.ceil(dist / sp));
  var out = [];
  for (var i = 1; i <= n; i++){
    out.push({ x: fromX + dx * (i / n), y: fromY + dy * (i / n), t: i / n });
  }
  return out;
}

/* 可复现随机（墨心同款）：同一 seed 生成同样的笔尖纹理/飞白。 */
function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function nowMs(){
  if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') return performance.now();
  return Date.now();
}

/* 历史栈（纯逻辑，可单测）：
 *   - maxUndo = 可撤步数上限（引擎用 60，契约要求 ≥50）
 *   - floor   = 前 floor 条已被"降级"成不可撤（长会话里由底图烘焙接管）
 *   - undo() 返回被弹出的 op；没有可撤时返回 null
 *   - removeAt/insertAt 给"提起重摆"用：把某一笔摘出来、放回原位（取消时）
 *   - bake(n) 摘走最老的 n 条（引擎把它们画进底图），floor 相应减少
 * 注意：被 bake 掉的 op 不进历史但视觉保留在底图 —— 撤销不会误删底图内容。*/
function createHistory(opts){
  opts = opts || {};
  var maxUndo = Math.max(1, Math.floor(opts.maxUndo) || 60);
  var ops = [];
  var floor = 0;

  function adjustFloorOnInsert(at){
    if (at < floor) floor += 1;
  }
  function adjustFloorOnRemove(at){
    if (at < floor) floor = Math.max(0, floor - 1);
  }

  return {
    maxUndo: maxUndo,
    get length(){ return ops.length; },
    push: function(op){
      ops.push(op);
      floor = Math.max(floor, ops.length - maxUndo);
      return ops.length;
    },
    undo: function(){
      if (ops.length <= floor) return null;
      return ops.pop();
    },
    canUndo: function(){ return ops.length > floor; },
    depth: function(){ return ops.length - floor; },
    peek: function(){ return ops.length ? ops[ops.length - 1] : null; },
    at: function(i){ return ops[i]; },
    all: function(){ return ops; },
    removeAt: function(i){
      if (!Number.isInteger(i) || i < 0 || i >= ops.length) return null;
      var out = ops.splice(i, 1)[0];
      adjustFloorOnRemove(i);
      return out;
    },
    insertAt: function(i, op){
      if (!op) return -1;
      var at = clamp(Math.floor(i), 0, ops.length);
      ops.splice(at, 0, op);
      adjustFloorOnInsert(at);
      return at;
    },
    clear: function(){ ops.length = 0; floor = 0; },
    /* 可烘焙条数 = 当前不可撤的条数（它们已经在"不能回头"的区域） */
    bakeCount: function(){ return floor; },
    bake: function(n){
      var k = Math.max(0, Math.min(Math.floor(n) || 0, ops.length));
      var out = k ? ops.splice(0, k) : [];
      floor = Math.max(0, floor - k);
      return out;
    },
  };
}
/* ============================================================
 * 二、自由笔的笔尖精灵（预生成，落笔时只 drawImage）
 *    墨间的 settleDab 是"每个点现画 10 个随机 blobs"，在透明大画布上
 *    每次 pointermove 都建路径/填圆代价高，也难保证撤销重放一致。
 *    这里改成：启动时按每个墨色预生成 3 张 128×128 的笔尖纹理
 *      soft = 湿晕（外圈很淡，管渗化）
 *      core = 笔芯（中心实，管笔道）
 *      dry  = 飞白（沿运笔方向抽掉细缝的笔芯）
 *    落笔时按参数 drawImage，op 里只存参数 ⇒ 撤销重放逐像素一致。
 * ============================================================ */

var SPRITE_SIZE = 128;

function buildTipSprite(rgb, kind, seed){
  var size = SPRITE_SIZE;
  var h = size / 2;
  var cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  var g = cv.getContext('2d');
  var rgbStr = rgb.r + ',' + rgb.g + ',' + rgb.b;
  var grad = g.createRadialGradient(h, h, 0, h, h, h);
  if (kind === 'soft'){
    grad.addColorStop(0, 'rgba(' + rgbStr + ',0.85)');
    grad.addColorStop(0.30, 'rgba(' + rgbStr + ',0.52)');
    grad.addColorStop(0.62, 'rgba(' + rgbStr + ',0.20)');
    grad.addColorStop(1, 'rgba(' + rgbStr + ',0)');
  } else if (kind === 'dry'){
    grad.addColorStop(0, 'rgba(' + rgbStr + ',0.95)');
    grad.addColorStop(0.55, 'rgba(' + rgbStr + ',0.62)');
    grad.addColorStop(1, 'rgba(' + rgbStr + ',0)');
  } else {
    grad.addColorStop(0, 'rgba(' + rgbStr + ',1)');
    grad.addColorStop(0.52, 'rgba(' + rgbStr + ',0.96)');
    grad.addColorStop(0.78, 'rgba(' + rgbStr + ',0.68)');
    grad.addColorStop(0.94, 'rgba(' + rgbStr + ',0.24)');
    grad.addColorStop(1, 'rgba(' + rgbStr + ',0)');
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);

  var rnd = mulberry32(seed);
  /* 颗粒：擦掉一点 alpha，像墨在纸纤维里吃得不匀（避免变成完美的圆） */
  g.save();
  g.globalCompositeOperation = 'destination-out';
  for (var i = 0; i < 180; i++){
    g.globalAlpha = 0.05 + rnd() * 0.12;
    var ang = rnd() * Math.PI * 2;
    var rad = Math.sqrt(rnd()) * h * 0.94;
    g.beginPath();
    g.arc(h + Math.cos(ang) * rad, h + Math.sin(ang) * rad, 0.5 + rnd() * 2.4, 0, Math.PI * 2);
    g.fill();
  }
  if (kind === 'dry'){
    /* 飞白：沿 +x 方向抽掉细缝（落笔时精灵随运笔方向旋转） */
    g.strokeStyle = '#000';
    g.lineCap = 'round';
    for (var k = 0; k < 24; k++){
      g.globalAlpha = 0.35 + rnd() * 0.6;
      g.lineWidth = 0.8 + rnd() * 2.6;
      var y0 = h + (rnd() - 0.5) * size * 0.9;
      var x0 = h + (rnd() - 0.5) * size * 0.5;
      var len = size * (0.16 + rnd() * 0.7);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x0 + len, y0 + (rnd() - 0.5) * size * 0.16);
      g.stroke();
    }
  }
  g.restore();
  return cv;
}

function buildSprites(palette){
  var out = [];
  for (var i = 0; i < palette.length; i++){
    var rgb = palette[i].rgb;
    out.push({
      soft: buildTipSprite(rgb, 'soft', 9001 + i * 17),
      core: buildTipSprite(rgb, 'core', 9101 + i * 17),
      dry:  buildTipSprite(rgb, 'dry', 9201 + i * 17),
    });
  }
  return out;
}

function drawSprite(g, sprite, x, y, radius, alpha, rot){
  if (!(alpha > 0.002) || !(radius > 0.2)) return;
  g.save();
  g.globalAlpha = Math.min(1, alpha);
  g.translate(x, y);
  if (rot) g.rotate(rot);
  var d = radius * 2;
  g.drawImage(sprite, -d / 2, -d / 2, d, d);
  g.restore();
}

/* ============================================================
 * 三、芥子园墨块：线稿形状 → 墨（墨心 renderPieceMask 的移植）
 *    掩膜是位图（一层 alpha），先做"同 alpha、只换颜色"的副本，
 *    再走 湿晕24遍 → 主体12~24遍 → 骨1遍 → 飞白 四层。
 *    buildRibs 从形状自己的梯度里找飞白落脚点和朝向。
 * ============================================================ */

var STAMP_INSET = 0.62;   // 几何只用画布中间这片 ⇒ 四周留白，湿晕不会被边缘裁成直角

function buildRibs(img, nw, nh){
  var R = 8;                                             // 每 8 个源像素一格
  var gw = Math.max(4, Math.round(nw / R));
  var gh = Math.max(4, Math.round(nh / R));
  var c = document.createElement('canvas');
  c.width = gw; c.height = gh;
  var g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, gw, gh);                        // 降采样本身带低通
  var d = g.getImageData(0, 0, gw, gh).data;
  var A = new Float32Array(gw * gh);
  for (var i = 0; i < gw * gh; i++) A[i] = d[i * 4 + 3] / 255;
  var B = new Float32Array(gw * gh);                     // 再抹一遍 3×3，去掉单格噪声
  for (var y = 0; y < gh; y++) for (var x = 0; x < gw; x++){
    var s = 0, n = 0;
    for (var j = -1; j <= 1; j++) for (var ii = -1; ii <= 1; ii++){
      var yy = y + j, xx = x + ii;
      if (yy < 0 || xx < 0 || yy >= gh || xx >= gw) continue;
      s += A[yy * gw + xx]; n++;
    }
    B[y * gw + x] = s / n;
  }
  var ribs = [];
  for (var y2 = 1; y2 < gh - 1; y2++) for (var x2 = 1; x2 < gw - 1; x2++){
    if (B[y2 * gw + x2] < 0.45) continue;                // 只在线条内部落脚
    var gx = B[y2 * gw + x2 + 1] - B[y2 * gw + x2 - 1];
    var gy = B[(y2 + 1) * gw + x2] - B[(y2 - 1) * gw + x2];
    var m = Math.sqrt(gx * gx + gy * gy);
    if (m < 1e-4) continue;
    ribs.push({ x: (x2 + 0.5) / gw, y: (y2 + 0.5) / gh, dx: -gy / m, dy: gx / m });
  }
  return ribs;
}

/* 渲染一块墨的离屏位图（透明底）。
 * entry = {id,label,g,z,seed,spec:{w,h,seed},ribs}
 * colored = 该墨色下、保 alpha 的着色掩膜副本
 * ink = 0..1（淡/中/浓），f = 该墨色的视觉重量补偿 */
function renderStampPiece(entry, colored, ink, D, f){
  var spec = entry.spec;
  var cw = Math.max(2, Math.round(spec.w * D));
  var ch = Math.max(2, Math.round(spec.h * D));
  var cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  var g = cv.getContext('2d');
  var iw = cw * STAMP_INSET;
  var ih = ch * STAMP_INSET;
  g.translate((cw - iw) / 2, (ch - ih) / 2);

  var rnd = mulberry32(spec.seed * 7 + 13);
  var base = Math.max(iw, ih);
  var ribs = entry.ribs || [];
  var weight = f || 1;

  /* 一遍 = 整层形状按 (缩放, 平移) 重画一次。
   * 手画块那边是"每遍重新抖动所有笔画点"，掩膜块换成"整层微缩放 + 微平移"，
   * 累积效果是同一件事：边缘按圆盘核衰减。不用 ctx.filter blur ——
   * Chromium 给带滤镜的绘制开的临时层按路径包围盒裁，反而留一圈直角硬边。*/
  function layer(alpha, opt){
    if (!(alpha > 0)) return;
    var o = opt || {};
    g.save();
    g.globalAlpha = Math.min(1, alpha * weight);
    var s = o.inflate || 1;
    g.translate(iw / 2 + (o.dx || 0), ih / 2 + (o.dy || 0));
    g.scale(s, s);
    g.translate(-iw / 2, -ih / 2);
    g.drawImage(colored, 0, 0, iw, ih);
    g.restore();
  }
  function wheel(radius, scale){
    var ang = rnd() * Math.PI * 2;
    var rad = radius * Math.sqrt(rnd());
    return {
      dx: Math.cos(ang) * rad,
      dy: Math.sin(ang) * rad,
      inflate: 1 + (scale || 0) * rnd(),
    };
  }

  /* 1) 湿晕：线稿本身只有 1~2 设备像素宽，没有这一圈就是一条硬细线。*/
  var WET_K = 24;
  var wetRk = 0.020;
  var wetA = 0.012 + 0.063 * ink;
  for (var k1 = 0; k1 < WET_K; k1++) layer(wetA, wheel(base * wetRk, 0.04));

  /* 2) 主体：多遍叠加 → 叠加处自然浓。总浓度公式与墨心逐字相同。*/
  var target = 1 - Math.pow(1 - (0.100 + 0.200 * ink), Math.round(3 + ink * 5));
  var bodyK = Math.round(12 + ink * 12);
  if (bodyK > 0){
    var mainA = 1 - Math.pow(1 - target, 1 / bodyK);
    for (var k2 = 0; k2 < bodyK; k2++) layer(mainA, wheel(base * 0.009, 0.006));
  }

  /* 3) 骨：收紧的芯，一遍。把形状层自己的浓淡带回来，否则二十来遍低 alpha 会压平。*/
  layer(0.200 + 0.450 * ink, {
    dx: (rnd() - 0.5) * base * 0.005,
    dy: (rnd() - 0.5) * base * 0.005,
  });

  /* 4) 飞白：墨越浓越飞白；落脚点和朝向来自 buildRibs。*/
  var nFly = Math.round((0.6 + ink * 4.4) * ribs.length / 900);
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.strokeStyle = '#000';
  g.lineCap = 'round';
  for (var k3 = 0; k3 < nFly; k3++){
    var r = ribs[Math.floor(rnd() * ribs.length)];
    if (!r) break;
    var px = iw * r.x;
    var py = ih * r.y;
    var len = base * (0.010 + rnd() * 0.030);
    var off = (rnd() - 0.5) * base * 0.020;
    g.globalAlpha = (0.05 + (0.16 + 0.34 * rnd()) * ink) * 0.7;
    g.lineWidth = base * (0.004 + rnd() * 0.011);
    g.beginPath();
    g.moveTo(px - r.dx * len / 2 - r.dy * off, py - r.dy * len / 2 + r.dx * off);
    g.lineTo(px + r.dx * len / 2 - r.dy * off, py + r.dy * len / 2 + r.dx * off);
    g.stroke();
  }
  g.restore();
  return cv;
}
/* ============================================================
 * 四、引擎本体
 * ============================================================ */

var DPR_CAP = 2;                 // devicePixelRatio 上限（再高对墨迹没有肉眼收益，内存翻倍）
var MAX_DEVICE_PIXELS = 7e6;     // 画布设备像素上限（1600×900@2x = 5.76M，留余量）
var HISTORY_MAX = 60;            // 可撤步数（契约要求 ≥50）
var BAKE_TRIGGER = 200;          // 历史长到这个数就把不可撤部分烘焙进底图
var STAMP_CACHE_MAX = 16;        // 墨块离屏位图 LRU 上限
var TINT_CACHE_MAX = 24;         // 着色掩膜 LRU 上限
var THUMB_CACHE_MAX = 48;        // 缩略图 dataURL 上限

export function createInkEngine(opts){
  opts = opts || {};
  var canvas = opts.canvas;
  if (!canvas || typeof canvas.getContext !== 'function'){
    throw new Error('createInkEngine: opts.canvas 必须是 canvas 元素');
  }
  var ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('createInkEngine: 2D context 不可用');

  var tCreate = nowMs();
  var palette = normalizePalette(opts.palette);
  var onChange = typeof opts.onChange === 'function' ? opts.onChange : null;
  var onFirstStroke = typeof opts.onFirstStroke === 'function' ? opts.onFirstStroke : null;

  var S = {
    /* 当前笔上的设置（对应契约的 setTool/setTone/...） */
    tool: 'brush',
    tone: 'medium',
    color: normalizeColorIndex(opts.defaultColor, palette.length, 0),
    size: 1,
    rotation: 0,
    stampId: null,
    interactive: opts.interactive !== false,

    /* 画布尺寸/DPR */
    cssW: 0, cssH: 0, dpr: 1, D: 2,

    /* 历史与底图 */
    history: createHistory({ maxUndo: HISTORY_MAX }),
    bakedOps: [],
    base: null,
    baseCtx: null,

    /* 掩膜 */
    stampDefs: [],
    stampById: new Map(),
    maskImgs: new Map(),
    maskRibs: new Map(),
    maskErrors: [],
    ready: false,

    /* 缓存 */
    tintCache: new Map(),
    stampCache: new Map(),
    thumbCache: new Map(),

    /* 交互中的临时态 */
    stroke: null,      // {op,lastX,lastY,lastT,pressure}
    live: null,        // 墨块拖动/待落：{op,fromIndex,moved,mode,startX,startY,grabDX,grabDY,original}
    scene: null,       // 墨块拖动期间的底图快照（drag 完即释放）
    activePointer: null,
    raf: 0,

    /* 回调/统计 */
    firstStrokeFired: false,
    firstInkAt: 0,
    destroyed: false,
    perf: {
      initMs: 0,
      masksReadyMs: 0,
      firstFrameMs: 0,
      lastStrokeMs: 0,
      maxStrokeMs: 0,
      lastStampMs: 0,
      undoMs: 0,
    },
  };

  var sprites = buildSprites(palette);   // 每个墨色 3 张笔尖精灵（启动时一次性生成）

  var listeners = [];
  var resizeObserver = null;
  var resizeTimer = 0;
  var readyResolve = null;
  var readyPromise = new Promise(function(res){ readyResolve = res; });
  var origTouchAction = canvas.style ? canvas.style.touchAction : '';
  var origPointerEvents = canvas.style ? canvas.style.pointerEvents : '';
  var origCursor = canvas.style ? canvas.style.cursor : '';
  if (canvas.style) canvas.style.touchAction = 'none';   // 触屏落墨不滚页面

  var masksInput = opts.masks && typeof opts.masks === 'object' ? opts.masks : null;
  var masksUrl = typeof opts.masksUrl === 'string' && opts.masksUrl ? opts.masksUrl : 'data/masks.json';

  /* ---------------- 尺寸 / DPR ---------------- */

  function measure(){
    var cssW = 0, cssH = 0;
    try { cssW = canvas.clientWidth || 0; cssH = canvas.clientHeight || 0; } catch (e) { cssW = 0; cssH = 0; }
    if (!cssW || !cssH){
      var r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
      if (r){ cssW = r.width; cssH = r.height; }
    }
    return { cssW: Math.max(1, Math.round(cssW)), cssH: Math.max(1, Math.round(cssH)) };
  }

  /* 墨块离屏位图的分辨率：≈ 落墨时的设备像素，避免放大糊（上限 2.5× 控内存）。
   * size=1 时 drawImage 基本 1:1；旋转/缩放由 drawImage 处理。 */
  function stampRenderD(){
    return clamp(S.dpr * (S.cssW / 800), 1.25, 2.5);
  }

  function applySize(){
    if (S.destroyed) return false;
    var m = measure();
    if (!m.cssW || !m.cssH) return false;
    var dpr = 1;
    if (typeof window !== 'undefined' && window.devicePixelRatio) dpr = Math.min(window.devicePixelRatio, DPR_CAP);
    var area = m.cssW * m.cssH;
    var dprEff = Math.min(dpr, Math.sqrt(MAX_DEVICE_PIXELS / Math.max(1, area)));
    var devW = Math.max(1, Math.round(m.cssW * dprEff));
    var devH = Math.max(1, Math.round(m.cssH * dprEff));
    var changed = devW !== canvas.width || devH !== canvas.height || m.cssW !== S.cssW || m.cssH !== S.cssH;
    if (!changed) return false;
    S.cssW = m.cssW;
    S.cssH = m.cssH;
    S.dpr = dprEff;
    S.D = stampRenderD();
    canvas.width = devW;
    canvas.height = devH;
    ctx.setTransform(dprEff, 0, 0, dprEff, 0, 0);
    S.stampCache.clear();                 // 分辨率变了，旧位图按新 D 重画
    if (S.base) rebuildBase();            // 底图按新尺寸重烘焙
    replay();
    return true;
  }

  /* ---------------- 缓存（LRU：命中挪到队尾，超上限丢队头） ---------------- */

  function lruGet(map, key){
    if (!map.has(key)) return null;
    var v = map.get(key);
    map.delete(key);
    map.set(key, v);
    return v;
  }

  function lruSet(map, key, val, max){
    map.set(key, val);
    while (map.size > max) map.delete(map.keys().next().value);
  }

  /* 着色掩膜：保 alpha、换成当前墨色（墨心的 source-in 做法） */
  function entryColored(entry, colorIdx){
    var key = entry.id + '|' + colorIdx;
    var cv = lruGet(S.tintCache, key);
    if (cv) return cv;
    var src = S.maskImgs.get(entry.id);
    if (!src) return null;
    cv = document.createElement('canvas');
    cv.width = src.naturalWidth || src.width;
    cv.height = src.naturalHeight || src.height;
    var g = cv.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = palette[colorIdx] ? palette[colorIdx].css : '#000000';
    g.fillRect(0, 0, cv.width, cv.height);
    lruSet(S.tintCache, key, cv, TINT_CACHE_MAX);
    return cv;
  }

  /* 墨块缓存键 = 块 id + 墨色号 + 浓淡档（与 SPEC「按 id+色彩缓存」一致） */
  function getStampPiece(id, colorIdx, tone){
    var entry = S.stampById.get(id);
    if (!entry) return null;
    var t = normalizeTone(tone);
    var key = id + '|' + colorIdx + '|' + t;
    var cv = lruGet(S.stampCache, key);
    if (cv) return cv;
    var colored = entryColored(entry, colorIdx);
    if (!colored) return null;
    var t0 = nowMs();
    cv = renderStampPiece(entry, colored, toneParams(t).ink, S.D || 2, palette[colorIdx] ? palette[colorIdx].f : 1);
    S.perf.lastStampMs = +(nowMs() - t0).toFixed(2);
    lruSet(S.stampCache, key, cv, STAMP_CACHE_MAX);
    return cv;
  }

  /* ---------------- 画：op → 像素（主画布与底图共用） ---------------- */

  function stampScale(size){
    return (S.cssW / 800) * (size == null ? S.size : size);
  }

  function drawStampAt(g, op, alpha){
    var entry = S.stampById.get(op.stamp);
    if (!entry) return false;
    var piece = getStampPiece(op.stamp, op.color, op.tone);
    if (!piece) return false;
    var k = stampScale(op.size);
    g.save();
    if (alpha != null && alpha !== 1) g.globalAlpha = alpha;
    g.translate(op.x * S.cssW, op.y * S.cssH);
    if (op.rot) g.rotate(op.rot * Math.PI / 180);
    g.drawImage(piece, -entry.spec.w * k / 2, -entry.spec.h * k / 2, entry.spec.w * k, entry.spec.h * k);
    g.restore();
    return true;
  }

  /* 一颗落笔点 = 湿晕 + 笔芯 + 飞白 三层精灵。
   * dab 里存的是参数（归一化坐标/半径/alpha/角度/飞白量），重放逐像素一致。 */
  function drawBrushDab(g, op, dab){
    var sp = sprites[op.color] || sprites[0];
    if (!sp) return;
    var x = dab.x * S.cssW;
    var y = dab.y * S.cssH;
    var r = Math.max(0.5, dab.r * S.cssW);
    drawSprite(g, sp.soft, x, y, r * 1.55, dab.a * 0.30, dab.rot);
    drawSprite(g, sp.core, x, y, r * 1.00, dab.a * (1 - dab.dry * 0.30), dab.rot);
    if (dab.dry > 0.02) drawSprite(g, sp.dry, x, y, r * 0.95, dab.a * dab.dry * 0.60, dab.rot);
  }

  function drawOp(g, op){
    if (!op) return;
    if (op.kind === 'brush'){
      for (var i = 0; i < op.dabs.length; i++) drawBrushDab(g, op, op.dabs[i]);
    } else if (op.kind === 'stamp'){
      drawStampAt(g, op, 1);
    }
  }

  function replay(){
    if (!S.cssW || !S.cssH) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (S.base) ctx.drawImage(S.base, 0, 0, canvas.width, canvas.height);
    ctx.restore();
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    var ops = S.history.all();
    for (var i = 0; i < ops.length; i++) drawOp(ctx, ops[i]);
  }
  /* ---------------- 底图烘焙：长会话里让撤销始终只重放最近 60 条 ---------------- */

  function rebuildBase(){
    S.base = document.createElement('canvas');
    S.base.width = Math.max(1, canvas.width);
    S.base.height = Math.max(1, canvas.height);
    S.baseCtx = S.base.getContext('2d');
    S.baseCtx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    for (var i = 0; i < S.bakedOps.length; i++) drawOp(S.baseCtx, S.bakedOps[i]);
  }

  function ensureBase(){
    if (S.base && S.base.width === canvas.width && S.base.height === canvas.height) return;
    rebuildBase();
  }

  /* 历史超过 BAKE_TRIGGER：把"已经不可撤"的老 op 画进底图并从栈里摘走。
   * 视觉不变（底图在重放时先画）；底图不参与撤销，所以撤销只会撤最近的可撤笔。*/
  function maybeBake(){
    if (S.history.length < BAKE_TRIGGER) return;
    var n = S.history.bakeCount();
    if (n <= 0) return;
    var moved = S.history.bake(n);
    if (!moved.length) return;
    ensureBase();
    for (var i = 0; i < moved.length; i++){
      drawOp(S.baseCtx, moved[i]);
      S.bakedOps.push(moved[i]);
    }
  }

  /* ---------------- 统计与回调 ---------------- */

  function quickCounts(){
    var strokes = 0, stamps = 0;
    var i;
    for (i = 0; i < S.bakedOps.length; i++){
      if (S.bakedOps[i].kind === 'stamp') stamps++; else strokes++;
    }
    var ops = S.history.all();
    for (i = 0; i < ops.length; i++){
      if (ops[i].kind === 'stamp') stamps++; else strokes++;
    }
    return { strokes: strokes, stamps: stamps };
  }

  function emitChange(){
    if (!onChange) return;
    try {
      var c = quickCounts();
      onChange({ strokes: c.strokes, stamps: c.stamps });
    } catch (e) { /* 使用方回调抛错不能弄坏引擎 */ }
  }

  /* 第一次真正见墨时触发 onFirstStroke（只触发一次；clear 不会重新触发） */
  function markInk(){
    if (!S.firstInkAt) S.firstInkAt = nowMs();
    if (!S.firstStrokeFired){
      S.firstStrokeFired = true;
      if (onFirstStroke){
        try { onFirstStroke(); } catch (e) { /* 同上 */ }
      }
    }
  }

  /* 墨覆盖率：把画布缩到 96px 宽再数 alpha 像素，避免全画布 getImageData 卡顿。 */
  function inkCoverage(){
    if (!S.cssW || !S.cssH) return 0;
    try {
      var SW = 96;
      var SH = Math.max(8, Math.round(SW * S.cssH / S.cssW));
      var c = document.createElement('canvas');
      c.width = SW; c.height = SH;
      var g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(canvas, 0, 0, SW, SH);
      var d = g.getImageData(0, 0, SW, SH).data;
      var n = 0;
      for (var i = 3; i < d.length; i += 4) if (d[i] > 3) n++;
      return +(n / (SW * SH)).toFixed(4);
    } catch (e) {
      return 0;
    }
  }

  function statsInternal(){
    var c = quickCounts();
    return {
      strokes: c.strokes,
      stamps: c.stamps,
      /* ms = 从第一次见墨到现在的时长（还没落墨就是 0） */
      ms: S.firstInkAt ? Math.max(0, Math.round(nowMs() - S.firstInkAt)) : 0,
      inkCoverage: inkCoverage(),
    };
  }

  function hasInkInternal(){
    return S.history.length > 0 || S.bakedOps.length > 0;
  }

  function undoInternal(){
    if (S.destroyed) return false;
    if (S.stroke || S.live) finishActive();
    var t0 = nowMs();
    var op = S.history.undo();
    if (!op) return false;
    replay();
    S.perf.undoMs = +(nowMs() - t0).toFixed(2);
    emitChange();
    return true;
  }

  function clearInternal(){
    if (S.destroyed) return;
    finishActive();
    S.history.clear();
    S.bakedOps.length = 0;
    if (S.base){ S.base.width = 0; S.base.height = 0; S.base = null; S.baseCtx = null; }
    replay();
    S.firstInkAt = 0;
    emitChange();
  }

  /* ---------------- 掩膜加载 ----------------
   * 优先级：opts.masks（对象） > globalThis.__INK_MASKS__（standalone 注入） > fetch(masksUrl)
   * 失败只 console.warn，不抛：自由笔不依赖掩膜，页面不能因为 11 张图挂掉。*/

  function refreshStampDefs(){
    S.stampDefs = Array.from(S.stampById.values()).sort(function(a, b){
      return (a.g - b.g) || (a.z - b.z);
    });
  }

  function decodeMask(name, m){
    return new Promise(function(res, rej){
      var im = new Image();
      im.onload = function(){
        try {
          var nw = im.naturalWidth || im.width;
          var nh = im.naturalHeight || im.height;
          var ribs = buildRibs(im, nw, nh);
          var spec = { w: m.w || 160, h: m.h || 120, seed: m.s || 1 };
          S.maskImgs.set(name, im);
          S.maskRibs.set(name, ribs);
          S.stampById.set(name, {
            id: name,
            label: m.t || name,
            g: m.g | 0,
            z: m.z | 0,
            spec: spec,
            ribs: ribs,
          });
          res();
        } catch (e) {
          rej(e);
        }
      };
      im.onerror = function(){ rej(new Error('掩膜解码失败：' + name)); };
      im.src = 'data:image/png;base64,' + m.b64;
    });
  }

  function applyMaskData(data){
    if (S.destroyed){ if (readyResolve) readyResolve(); return; }
    var names = Object.keys(data || {});
    var failed = [];
    var tasks = [];
    for (var i = 0; i < names.length; i++){
      var name = names[i];
      var m = data[name];
      if (!m || typeof m.b64 !== 'string'){ failed.push(name); continue; }
      tasks.push(decodeMask(name, m).catch(function(){ /* 具体名字在解构时记 */ }));
    }
    /* onerror 的闭包拿不到 name，这里用二次扫描补记失败项 */
    var failedSet = new Set(failed);
    Promise.all(tasks.map(function(p){ return p; })).then(function(){
      for (var k = 0; k < names.length; k++){
        if (!S.stampById.has(names[k])) failedSet.add(names[k]);
      }
      S.maskErrors = Array.from(failedSet);
      refreshStampDefs();
      S.ready = true;
      S.perf.masksReadyMs = +(nowMs() - tCreate).toFixed(1);
      S.perf.firstFrameMs = S.perf.masksReadyMs;
      if (S.maskErrors.length && typeof console !== 'undefined' && console.warn){
        console.warn('[ink-engine] 掩膜部分失败（这些墨块不可用）：', S.maskErrors.join(', '));
      } else if (typeof console !== 'undefined' && console.info){
        console.info('[ink-engine] 就绪 · 墨块 ' + S.stampDefs.length + ' 块 · '
          + S.perf.masksReadyMs + 'ms · D=' + S.D.toFixed(2)
          + ' · dpr=' + (S.dpr || 1).toFixed(2));
      }
      warmStamps();
      if (readyResolve) readyResolve();
    });
  }

  function scheduleIdle(fn){
    if (typeof requestIdleCallback === 'function') requestIdleCallback(function(){ fn(); }, { timeout: 800 });
    else setTimeout(fn, 16);
  }

  /* 空闲时提前渲染当前墨色/浓淡下的 11 块，第一次点墨块不卡。 */
  function warmStamps(){
    var defs = S.stampDefs;
    if (!defs.length) return;
    var i = 0;
    function step(){
      if (S.destroyed || i >= defs.length) return;
      var end = Math.min(defs.length, i + 2);
      for (; i < end; i++) getStampPiece(defs[i].id, S.color, S.tone);
      if (i < defs.length) scheduleIdle(step);
    }
    scheduleIdle(step);
  }

  function bootMasks(){
    var data = masksInput;
    if (!data && typeof globalThis !== 'undefined' && globalThis.__INK_MASKS__){
      data = globalThis.__INK_MASKS__;
    }
    if (data && typeof data === 'object'){ applyMaskData(data); return; }
    if (typeof fetch !== 'function'){ applyMaskData({}); return; }
    /* 不做 new URL(import.meta.url)：standalone/本地/子路径都按页面相对路径解析 */
    fetch(masksUrl, { cache: 'force-cache' }).then(function(res){
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function(json){
      applyMaskData(json);
    }).catch(function(err){
      if (typeof console !== 'undefined' && console.warn){
        console.warn('[ink-engine] 掩膜加载失败（' + masksUrl + '）：' + (err && err.message ? err.message : err)
          + '。自由笔不受影响；墨块工具暂时不可用。');
      }
      S.maskErrors = ['__load__'];
      applyMaskData({});
    });
  }
  /* ---------------- 自由笔 ---------------- */

  /* 笔的基准半径（CSS px）。
   * 标定依据：Lead 在真 app（1440×900、收卷合成 2880 宽）实测反馈"默认笔像铅笔线"。
   * 取 画布宽 × 0.008 ≈ 中调 11.5px（1440 时）；size 走 1.35 次幂：
   *   ×0.5 ≈ 4.5px · ×1 ≈ 11.5px · ×2 ≈ 29px（与 Lead 给的 4 / 9–12 / 24–30 对齐）。
   * 下限 4px 保证手机窄屏也成"墨线"而不是发丝。 */
  function brushBaseRadius(){
    var w = S.cssW || 800;
    var size = normalizeSize(S.size);
    return clamp(w * 0.008 * Math.pow(size, 1.35), 5, w * 0.024);
  }

  function pressureOf(e){
    if (!e) return 1;
    if (e.pointerType === 'pen' && typeof e.pressure === 'number' && e.pressure > 0){
      return clamp(0.45 + e.pressure * 1.1, 0.4, 1.5);
    }
    return 1;
  }

  /* 一颗落笔点入 op：坐标 0..1、半径按画布宽归一化 —— resize 后重放仍同构图。*/
  function pushDab(op, x, y, radiusPx, alpha, rot, dry){
    op.dabs.push({
      x: +clamp(x, -0.2, 1.2).toFixed(5),
      y: +clamp(y, -0.2, 1.2).toFixed(5),
      r: Math.max(0.0008, radiusPx / Math.max(1, S.cssW)),
      a: clamp(alpha, 0.004, 0.85),
      rot: Math.round(rot * 1000) / 1000,
      dry: clamp(dry, 0, 0.85),
    });
  }

  function makeDab(op, x, y, radiusPx, angle, pressureK, rnd){
    var tone = toneParams(op.tone);
    var r = radiusPx * (0.82 + rnd() * 0.34);
    var a = 0.140 * tone.alpha * (0.70 + rnd() * 0.60) * (0.9 + pressureK * 0.1);
    var dry = clamp(tone.dry * (0.35 + rnd() * 1.00) + (rnd() < 0.12 ? 0.16 : 0), 0, 0.70);
    pushDab(op, x, y, r, a, angle + (rnd() - 0.5) * 0.5, dry);
  }

  function beginBrush(pt, e){
    var tone = normalizeTone(S.tone);
    var pressureK = pressureOf(e);
    var op = { kind: 'brush', color: S.color, tone: tone, size: normalizeSize(S.size), dabs: [] };
    S.stroke = { op: op, lastX: pt.x, lastY: pt.y, lastT: nowMs(), pressure: pressureK };
    markInk();
    var t0 = nowMs();
    var tp = toneParams(tone);
    var base = brushBaseRadius() * tp.radius * clamp(0.6 + pressureK * 0.5, 0.6, 1.4);
    var rnd = Math.random;
    /* 点落：三颗微错位的点 + 一颗很淡的渗化边 —— 墨点本来就不是规整圆 */
    makeDab(op, pt.x, pt.y, base, 0, pressureK, rnd);
    makeDab(op, pt.x + (rnd() - 0.5) * 0.004, pt.y + (rnd() - 0.5) * 0.004, base * 0.78, 0, pressureK, rnd);
    pushDab(op, pt.x, pt.y, base * 1.9, 0.008 * tp.alpha, 0, 0);
    for (var i = 0; i < op.dabs.length; i++) drawBrushDab(ctx, op, op.dabs[i]);
    S.perf.lastStrokeMs = +(nowMs() - t0).toFixed(2);
  }

  function strokeTo(pt){
    var s = S.stroke;
    if (!s) return;
    var op = s.op;
    var dxPx = (pt.x - s.lastX) * S.cssW;
    var dyPx = (pt.y - s.lastY) * S.cssH;
    var distPx = Math.sqrt(dxPx * dxPx + dyPx * dyPx);
    if (distPx < 0.6) return;
    var dt = Math.max(1, nowMs() - s.lastT);
    var speed = distPx / dt;                     // px/ms
    var baseR = brushBaseRadius();
    var tp = toneParams(op.tone);
    var stepLen = Math.max(1.0, baseR * 0.26);
    var steps = Math.min(48, Math.max(1, Math.round(distPx / stepLen)));
    var widthK = clamp(1.24 - speed / 2.4, 0.62, 1.22);   // 慢 = 重 = 宽（墨间手感）
    var angle = Math.atan2(dyPx, dxPx);
    var rnd = Math.random;
    var n0 = op.dabs.length;
    for (var i = 1; i <= steps; i++){
      var t = i / steps;
      var nx = s.lastX + (pt.x - s.lastX) * t;
      var ny = s.lastY + (pt.y - s.lastY) * t;
      var r = baseR * tp.radius * widthK * (0.86 + rnd() * 0.3) * s.pressure;
      makeDab(op, nx, ny, r, angle, s.pressure, rnd);
      if (i % 3 === 0) pushDab(op, nx, ny, r * 1.6, 0.007 * tp.alpha, angle, 0);   // 湿晕
    }
    /* 实时只画新增点，不整屏重绘 */
    for (var k = n0; k < op.dabs.length; k++) drawBrushDab(ctx, op, op.dabs[k]);
    s.lastX = pt.x;
    s.lastY = pt.y;
    s.lastT = nowMs();
  }

  function endBrush(commit){
    var s = S.stroke;
    if (!s) return;
    S.stroke = null;
    var op = s.op;
    if (!op.dabs.length || !commit){ replay(); return; }
    S.history.push(op);
    maybeBake();
    emitChange();
  }

  /* ---------------- 墨块：点按落墨 / 按住已落墨块提起重摆 ---------------- */

  function hitTestStamp(nx, ny){
    var ops = S.history.all();
    for (var i = ops.length - 1; i >= 0; i--){
      var op = ops[i];
      if (op.kind !== 'stamp') continue;
      var entry = S.stampById.get(op.stamp);
      if (!entry) continue;
      var dx = (nx - op.x) * S.cssW;
      var dy = (ny - op.y) * S.cssH;
      var a = -op.rot * Math.PI / 180;
      var lx = dx * Math.cos(a) - dy * Math.sin(a);
      var ly = dx * Math.sin(a) + dy * Math.cos(a);
      var k = stampScale(op.size);
      if (Math.abs(lx) <= entry.spec.w * k / 2 && Math.abs(ly) <= entry.spec.h * k / 2){
        return { index: i, op: op };
      }
    }
    return null;
  }

  function snapshotScene(){
    if (!S.scene) S.scene = document.createElement('canvas');
    S.scene.width = Math.max(1, canvas.width);
    S.scene.height = Math.max(1, canvas.height);
    var g = S.scene.getContext('2d');
    g.clearRect(0, 0, S.scene.width, S.scene.height);
    g.drawImage(canvas, 0, 0);
  }

  function restoreScene(){
    if (!S.scene){ replay(); return; }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(S.scene, 0, 0, canvas.width, canvas.height);
    ctx.restore();
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  }

  function releaseScene(){
    if (!S.scene) return;
    S.scene.width = 0;
    S.scene.height = 0;
    S.scene = null;
  }

  function drawLiveFrame(op){
    var entry = S.stampById.get(op.stamp);
    if (!entry) return;
    var k = stampScale(op.size);
    var w = entry.spec.w * k;
    var h = entry.spec.h * k;
    ctx.save();
    ctx.translate(op.x * S.cssW, op.y * S.cssH);
    if (op.rot) ctx.rotate(op.rot * Math.PI / 180);
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(61,74,58,.5)';
    ctx.lineWidth = 1.1;
    ctx.strokeRect(-w / 2 - 5, -h / 2 - 5, w + 10, h + 10);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -h / 2 - 12);
    ctx.strokeStyle = 'rgba(61,74,58,.75)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(61,74,58,.75)';
    ctx.fill();
    ctx.restore();
  }

  function drawStampLive(){
    var L = S.live;
    if (!L || !S.cssW) return;
    restoreScene();
    drawStampAt(ctx, L.op, 1);
    drawLiveFrame(L.op);
  }

  function scheduleLiveFrame(){
    if (S.raf) return;
    S.raf = requestAnimationFrame(function(){ S.raf = 0; drawStampLive(); });
  }

  function beginStampLive(pt){
    var hit = hitTestStamp(pt.x, pt.y);
    var live = null;
    if (hit){
      var removed = S.history.removeAt(hit.index);
      if (!removed) return;
      replay();                              // 底图 = 把这一块摘掉后的画面
      live = {
        op: {
          kind: 'stamp', stamp: removed.stamp, x: removed.x, y: removed.y, rot: removed.rot,
          size: removed.size, color: removed.color, tone: removed.tone,
        },
        fromIndex: hit.index,
        mode: 'move',
        startX: pt.x,
        startY: pt.y,
        grabDX: pt.x - removed.x,
        grabDY: pt.y - removed.y,
        original: removed,
        moved: false,
      };
    } else {
      var id = S.stampId;
      if ((!id || !S.stampById.has(id)) && S.stampDefs.length) id = S.stampDefs[0].id;
      if (!id || !S.stampById.has(id)) return;   // 掩膜还没就绪/无墨块：静默不动
      live = {
        op: {
          kind: 'stamp', stamp: id, x: pt.x, y: pt.y, rot: S.rotation,
          size: normalizeSize(S.size), color: S.color, tone: normalizeTone(S.tone),
        },
        fromIndex: -1,
        mode: 'new',
        startX: pt.x,
        startY: pt.y,
        grabDX: 0,
        grabDY: 0,
        original: null,
        moved: false,
      };
    }
    S.live = live;
    markInk();
    if (live.mode === 'move'){
      snapshotScene();
      drawStampLive();
    }
    /* 新墨块按下时先不画（点按=松开才落墨）：省掉每一下都整屏拷画布的往返。
       一旦开始拖，moveStampLive 里再补快照和预览。*/
  }

  function moveStampLive(pt){
    var L = S.live;
    if (!L) return;
    var dxPx = (pt.x - L.startX) * S.cssW;
    var dyPx = (pt.y - L.startY) * S.cssH;
    if (!L.moved && Math.sqrt(dxPx * dxPx + dyPx * dyPx) > 2) L.moved = true;
    L.op.x = clamp(pt.x - L.grabDX, 0, 1);
    L.op.y = clamp(pt.y - L.grabDY, 0, 1);
    if (L.moved){
      if (!S.scene) snapshotScene();
      scheduleLiveFrame();
    }
  }

  /* 落定：
   *  - 新墨块：直接在按下的位置落墨（点按落墨）
   *  - 提起旧墨块：松开时落在新位置；按下不拖直接松开 = 放回原处（明确取消，不进历史）
   * 撤销永远只撤最近一次落墨，与拖没拖过无关。*/
  function endStampLive(){
    var L = S.live;
    if (!L) return;
    S.live = null;
    if (S.raf){ try { cancelAnimationFrame(S.raf); } catch (e) {} S.raf = 0; }
    if (L.mode === 'move' && !L.moved && L.original){
      S.history.insertAt(L.fromIndex, L.original);   // 没动 → 放回原位，历史不变
      releaseScene();
      replay();
      return;
    }
    S.history.push(L.op);
    if (S.scene){
      restoreScene();
      drawStampAt(ctx, L.op, 1);
      releaseScene();
    } else {
      drawStampAt(ctx, L.op, 1);
    }
    maybeBake();
    emitChange();
  }

  function finishActive(){
    if (S.stroke) endBrush(true);
    if (S.live) endStampLive();
    S.activePointer = null;
  }

  /* ---------------- pointer events（鼠标 / 触屏 / 笔） ---------------- */

  function eventPoint(e){
    var rect = canvas.getBoundingClientRect
      ? canvas.getBoundingClientRect()
      : { left: 0, top: 0, width: S.cssW, height: S.cssH };
    return coordsToNormalized(e.clientX, e.clientY, rect);
  }

  function canDraw(){ return !S.destroyed && S.interactive; }

  function onPointerDown(e){
    if (!canDraw()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!S.cssW || !S.cssH) applySize();
    if (!S.cssW || !S.cssH) return;
    if (S.activePointer != null) return;                   // 只认一根手指/一支笔
    if (e.cancelable){ try { e.preventDefault(); } catch (err) {} }
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    S.activePointer = e.pointerId;
    var pt = eventPoint(e);
    if (S.tool === 'stamp') beginStampLive(pt);
    else beginBrush(pt, e);
  }

  function onPointerMove(e){
    if (!canDraw()) return;
    if (S.activePointer == null || e.pointerId !== S.activePointer) return;
    if (e.cancelable){ try { e.preventDefault(); } catch (err) {} }
    var pt = eventPoint(e);
    if (S.stroke){
      var t0 = nowMs();
      strokeTo(pt);
      var dt = nowMs() - t0;
      S.perf.lastStrokeMs = +dt.toFixed(2);
      if (dt > S.perf.maxStrokeMs) S.perf.maxStrokeMs = +dt.toFixed(2);
    } else if (S.live){
      moveStampLive(pt);
    }
  }

  function onPointerUp(e){
    if (S.activePointer != null && e && e.pointerId !== S.activePointer) return;
    S.activePointer = null;
    try {
      if (e && canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    } catch (err) {}
    if (S.stroke) endBrush(true);
    else if (S.live) endStampLive();
  }
  /* ---------------- 对外 API（SPEC §4 契约 + 少量扩展） ---------------- */

  function applyCursor(){
    if (!canvas.style) return;
    canvas.style.cursor = S.interactive ? 'crosshair' : 'default';
    canvas.style.pointerEvents = S.interactive ? origPointerEvents : 'none';
  }

  function addListener(target, type, fn, options){
    target.addEventListener(type, fn, options);
    listeners.push([target, type, fn, options]);
  }

  function scheduleResize(){
    if (resizeTimer) return;
    resizeTimer = setTimeout(function(){ resizeTimer = 0; applySize(); }, 120);
  }

  function getStampThumb(id, o){
    o = o || {};
    var entry = S.stampById.get(String(id));
    if (!entry) return '';
    var colorIdx = normalizeColorIndex(o.color == null ? S.color : o.color, palette.length, 0);
    var tone = normalizeTone(o.tone || S.tone);
    var width = Math.round(clamp(o.width || 120, 24, 320));
    var key = entry.id + '|' + colorIdx + '|' + tone + '|' + width;
    var cached = S.thumbCache.get(key);
    if (cached) return cached;
    var colored = entryColored(entry, colorIdx);
    if (!colored) return '';
    var D = clamp(width / Math.max(1, entry.spec.w), 0.08, 2.5);
    var piece = renderStampPiece(entry, colored, toneParams(tone).ink, D, palette[colorIdx] ? palette[colorIdx].f : 1);
    var url = '';
    try { url = piece.toDataURL('image/png'); } catch (e) { url = ''; }
    if (S.thumbCache.size > THUMB_CACHE_MAX) S.thumbCache.clear();
    if (url) S.thumbCache.set(key, url);
    return url;
  }

  var engine = {
    /* ---------- 契约方法（SPEC §4） ---------- */
    setTool: function(tool){
      var t = tool === 'stamp' ? 'stamp' : 'brush';
      if (t === S.tool) return;
      finishActive();
      S.tool = t;
      if (t === 'stamp' && !S.stampId && S.stampDefs.length) S.stampId = S.stampDefs[0].id;
      applyCursor();
    },
    setTone: function(tone){ S.tone = normalizeTone(tone); },
    setColor: function(i){ S.color = normalizeColorIndex(i, palette.length, 0); },
    setSize: function(v){ S.size = normalizeSize(v); },
    setRotation: function(deg){ S.rotation = normalizeRotation(deg); },
    setStamp: function(id){
      if (id == null || id === ''){ S.stampId = null; return; }
      S.stampId = String(id);
    },
    undo: function(){ return undoInternal(); },
    clear: function(){ clearInternal(); },
    hasInk: function(){ return hasInkInternal(); },
    stats: function(){ return statsInternal(); },
    toDataURL: function(type){
      try { return canvas.toDataURL(type || 'image/png'); } catch (e) { return ''; }
    },
    setInteractive: function(v){
      S.interactive = !!v;
      if (!S.interactive) finishActive();
      applyCursor();
    },
    resize: function(){ applySize(); },
    destroy: destroy,

    /* ---------- 扩展（契约之外，可选） ---------- */
    ready: readyPromise,
    isReady: function(){ return S.ready; },
    getStamps: function(){
      return S.stampDefs.map(function(e){
        return { id: e.id, label: e.label, g: e.g, z: e.z, w: e.spec.w, h: e.spec.h };
      });
    },
    getPalette: function(){
      return palette.map(function(c, i){
        return { index: i, css: c.css, rgb: { r: c.rgb.r, g: c.rgb.g, b: c.rgb.b }, f: c.f };
      });
    },
    getStampThumb: getStampThumb,
    getSettings: function(){
      return {
        tool: S.tool, tone: S.tone, color: S.color, size: S.size,
        rotation: S.rotation, stampId: S.stampId, interactive: S.interactive,
      };
    },
    getPerf: function(){
      return {
        initMs: S.perf.initMs,
        masksReadyMs: S.perf.masksReadyMs,
        firstFrameMs: S.perf.firstFrameMs,
        lastStrokeMs: S.perf.lastStrokeMs,
        maxStrokeMs: S.perf.maxStrokeMs,
        lastStampMs: S.perf.lastStampMs,
        undoMs: S.perf.undoMs,
        dpr: +S.dpr.toFixed(3),
        cssW: S.cssW,
        cssH: S.cssH,
        deviceW: canvas.width,
        deviceH: canvas.height,
        undoDepth: S.history.depth(),
        opCount: S.history.length + S.bakedOps.length,
        bakedCount: S.bakedOps.length,
        stampCache: S.stampCache.size,
      };
    },
    getMaskErrors: function(){ return S.maskErrors.slice(); },
  };

  /* stampIds 用 getter：掩膜异步到达，数组要实时可读（工具条/demo 用） */
  Object.defineProperty(engine, 'stampIds', {
    enumerable: true,
    get: function(){ return S.stampDefs.map(function(e){ return e.id; }); },
  });

  function destroy(){
    if (S.destroyed) return;
    S.destroyed = true;
    for (var i = 0; i < listeners.length; i++){
      var L = listeners[i];
      try { L[0].removeEventListener(L[1], L[2], L[3]); } catch (e) { /* ignore */ }
    }
    listeners.length = 0;
    if (resizeObserver){ try { resizeObserver.disconnect(); } catch (e) {} resizeObserver = null; }
    if (resizeTimer){ clearTimeout(resizeTimer); resizeTimer = 0; }
    if (S.raf){ try { cancelAnimationFrame(S.raf); } catch (e) {} S.raf = 0; }
    releaseScene();
    if (S.base){ S.base.width = 0; S.base.height = 0; S.base = null; S.baseCtx = null; }
    S.stampCache.clear();
    S.tintCache.clear();
    S.thumbCache.clear();
    S.history.clear();
    S.bakedOps.length = 0;
    S.stroke = null;
    S.live = null;
    if (canvas.style){
      canvas.style.touchAction = origTouchAction || '';
      canvas.style.pointerEvents = origPointerEvents || '';
      canvas.style.cursor = origCursor || '';
    }
    try { canvas.width = 0; canvas.height = 0; } catch (e) { /* ignore */ }
    if (readyResolve) readyResolve();   // destroy 后 ready 也不要永远悬着
  }

  /* ---------------- 启动 ---------------- */

  addListener(canvas, 'pointerdown', onPointerDown, { passive: false });
  addListener(canvas, 'pointermove', onPointerMove, { passive: false });
  addListener(canvas, 'pointerup', onPointerUp, { passive: true });
  addListener(canvas, 'pointercancel', onPointerUp, { passive: true });

  if (typeof ResizeObserver === 'function'){
    try {
      resizeObserver = new ResizeObserver(function(){ scheduleResize(); });
      resizeObserver.observe(canvas);
    } catch (e) { resizeObserver = null; }
  }
  if (typeof window !== 'undefined'){
    addListener(window, 'resize', scheduleResize, { passive: true });
  }

  applyCursor();
  applySize();
  S.perf.initMs = +(nowMs() - tCreate).toFixed(2);
  bootMasks();

  return engine;
}

/* ============================================================
 * 五、纯逻辑测试出口
 *   不额外具名导出（build-standalone 约定本模块只有 createInkEngine 一个导出）；
 *   node --test 通过 createInkEngine.pure 取用，不依赖任何 DOM。
 * ============================================================ */
createInkEngine.pure = {
  clamp: clamp,
  hexToRgb: hexToRgb,
  rgbCss: rgbCss,
  rgbLum: rgbLum,
  colorWeight: colorWeight,
  normalizePalette: normalizePalette,
  TONES: TONES,
  normalizeTone: normalizeTone,
  toneParams: toneParams,
  normalizeSize: normalizeSize,
  normalizeRotation: normalizeRotation,
  normalizeColorIndex: normalizeColorIndex,
  coordsToNormalized: coordsToNormalized,
  brushSteps: brushSteps,
  createHistory: createHistory,
  mulberry32: mulberry32,
};