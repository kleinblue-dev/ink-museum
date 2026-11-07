// export.js — 把「当前画布比例 ×2」合成为一卷画：宣纸底 + 画心 + 落款朱砂印 + 展签 + 日期。
// 不依赖任何外部字体/图片：纸纹用确定性伪随机程序绘制，印章与文字用 canvas 原生绘制。
// composeCanvasSize / parsePosition / formatDate 为纯函数，可在 node --test 里直接测。

export const SEAL_COLOR = '#9e3b2e';
export const PAPER_COLOR = '#e9e0cd';
export const SCROLL_MAX_EDGE = 3000;
export const SCROLL_SCALE = 2;

export function composeCanvasSize(cssWidth, cssHeight, options) {
  const opts = options || {};
  const scale = Number.isFinite(opts.scale) && opts.scale > 0 ? opts.scale : SCROLL_SCALE;
  const maxEdge = Number.isFinite(opts.maxEdge) && opts.maxEdge > 0 ? opts.maxEdge : SCROLL_MAX_EDGE;
  const rawW = Number(cssWidth);
  const rawH = Number(cssHeight);
  const baseW = Number.isFinite(rawW) && rawW > 0 ? rawW : 800;
  const baseH = Number.isFinite(rawH) && rawH > 0 ? rawH : 500;
  let width = Math.max(2, Math.round(baseW * scale));
  let height = Math.max(2, Math.round(baseH * scale));
  const longest = Math.max(width, height);
  if (longest > maxEdge) {
    const ratio = maxEdge / longest;
    width = Math.max(2, Math.round(width * ratio));
    height = Math.max(2, Math.round(height * ratio));
  }
  return { width, height };
}

export function parsePosition(value) {
  if (typeof value !== 'string') return { x: 0.5, y: 0.5 };
  const parts = value.trim().split(/\s+/);
  const toRatio = (token) => {
    if (typeof token !== 'string') return 0.5;
    if (token.charAt(token.length - 1) === '%') {
      const n = parseFloat(token);
      return Number.isFinite(n) ? Math.min(1, Math.max(0, n / 100)) : 0.5;
    }
    return 0.5;
  };
  return { x: toRatio(parts[0]), y: toRatio(parts[1]) };
}

export function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate());
}

function exportMulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawPaper(ctx, width, height, seed) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#efe7d6');
  gradient.addColorStop(0.52, '#e8dfcb');
  gradient.addColorStop(1, '#ddd0b8');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const rand = exportMulberry32(seed);
  const dots = Math.min(5200, Math.round((width * height) / 5200));
  ctx.fillStyle = '#6b5f4c';
  for (let i = 0; i < dots; i += 1) {
    ctx.globalAlpha = 0.02 + rand() * 0.05;
    const x = rand() * width;
    const y = rand() * height;
    const size = rand() < 0.82 ? 1 : 2;
    ctx.fillRect(x, y, size, size);
  }
  // 几道极淡的纸筋
  ctx.strokeStyle = '#8a7b63';
  for (let i = 0; i < 9; i += 1) {
    ctx.globalAlpha = 0.018 + rand() * 0.022;
    ctx.lineWidth = 1;
    const y = rand() * height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(width * 0.3, y + rand() * 6 - 3, width * 0.7, y + rand() * 6 - 3, width, y + rand() * 4 - 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawCover(ctx, image, rect, position) {
  const iw = image.naturalWidth || image.width || 0;
  const ih = image.naturalHeight || image.height || 0;
  if (!iw || !ih) return;
  const scale = Math.max(rect.w / iw, rect.h / ih);
  const drawW = iw * scale;
  const drawH = ih * scale;
  const pos = position || { x: 0.5, y: 0.5 };
  const offsetX = (drawW - rect.w) * pos.x;
  const offsetY = (drawH - rect.h) * pos.y;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.drawImage(image, rect.x - offsetX, rect.y - offsetY, drawW, drawH);
  ctx.restore();
}

function serifFont(weight, size) {
  return weight + ' ' + Math.round(size) + 'px "Songti SC","STSong","SimSun","KaiTi",serif';
}

function drawSeal(ctx, x, y, size, sealText, rotateDeg) {
  const chars = String(sealText || '').split('').slice(0, 2);
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  ctx.rotate(((typeof rotateDeg === 'number' ? rotateDeg : -1.6) * Math.PI) / 180);
  ctx.fillStyle = SEAL_COLOR;
  ctx.globalAlpha = 0.94;
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(239,229,209,0.42)';
  ctx.lineWidth = Math.max(1, size * 0.022);
  ctx.strokeRect(-size / 2 + size * 0.055, -size / 2 + size * 0.055, size * 0.89, size * 0.89);
  ctx.fillStyle = '#efe5d1';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const font = serifFont(400, size * 0.36);
  ctx.font = font;
  const gap = size * 0.24;
  if (chars.length >= 2) {
    ctx.fillText(chars[0], 0, -gap);
    ctx.fillText(chars[1], 0, gap);
  } else if (chars.length === 1) {
    ctx.fillText(chars[0], 0, 0);
  }
  ctx.restore();
}

// cfg = { bgImg, inkCanvas, cssWidth, cssHeight, scene, content, date, seed }
export function composeScroll(cfg) {
  const options = cfg || {};
  const content = options.content || {};
  const scene = options.scene || null;
  const inkCanvas = options.inkCanvas || null;
  const bgImg = options.bgImg || null;
  const cssWidth = options.cssWidth || (inkCanvas ? inkCanvas.clientWidth : 0) || 1440;
  const cssHeight = options.cssHeight || (inkCanvas ? inkCanvas.clientHeight : 0) || 900;
  const size = composeCanvasSize(cssWidth, cssHeight);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas-2d-unavailable');

  const W = size.width;
  const H = size.height;
  const seed = typeof options.seed === 'number' ? options.seed : 20261107;
  drawPaper(ctx, W, H, seed);

  const padX = Math.round(W * 0.055);
  const padTop = Math.round(H * 0.052);
  const padBottom = Math.round(H * 0.15);
  const rect = {
    x: padX,
    y: padTop,
    w: Math.max(4, W - padX * 2),
    h: Math.max(4, H - padTop - padBottom)
  };

  // 画心底色（背景图缺失时也能收卷）
  ctx.fillStyle = '#ded3bc';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  const position = parsePosition(scene && scene.bg ? scene.bg.position : '');
  if (bgImg) drawCover(ctx, bgImg, rect, position);

  if (inkCanvas && inkCanvas.width > 1 && inkCanvas.height > 1) {
    try {
      ctx.drawImage(inkCanvas, rect.x, rect.y, rect.w, rect.h);
    } catch (err) {
      /* 墨层绘制失败不阻断收卷 */
    }
  }

  // 画心压边（细墨线 + 外留纸边）
  const hair = Math.max(1, Math.round(W / 1600));
  ctx.strokeStyle = 'rgba(42,35,26,0.42)';
  ctx.lineWidth = hair;
  ctx.strokeRect(rect.x - hair, rect.y - hair, rect.w + hair * 2, rect.h + hair * 2);
  ctx.strokeStyle = 'rgba(42,35,26,0.16)';
  ctx.lineWidth = hair;
  ctx.strokeRect(rect.x - hair * 4, rect.y - hair * 4, rect.w + hair * 8, rect.h + hair * 8);

  // 展签：画作 · 作者 · 朝代
  const work = (scene && scene.work) || {};
  const captionParts = [work.title, work.artist, work.dynasty].filter((part) => typeof part === 'string' && part.length);
  const caption = captionParts.join(' · ');

  const belowTop = rect.y + rect.h;
  const belowHeight = H - belowTop;
  const captionSize = Math.max(12, Math.round(W * 0.018));
  const smallSize = Math.max(10, Math.round(W * 0.0115));

  if (caption) {
    ctx.fillStyle = 'rgba(42,35,26,0.82)';
    ctx.font = serifFont(400, captionSize);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(caption, W / 2, belowTop + belowHeight * 0.3);
  }

  const dateText = formatDate(options.date || new Date());
  if (dateText) {
    ctx.fillStyle = 'rgba(42,35,26,0.48)';
    ctx.font = serifFont(400, smallSize);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(dateText, W / 2, belowTop + belowHeight * 0.56);
  }

  const sealText = (content.scroll && content.scroll.seal) || '';
  const sealSize = Math.max(26, Math.round(Math.min(W, H) * 0.085));
  drawSeal(ctx, W - padX - sealSize, belowTop + belowHeight * 0.42, sealSize, sealText, -1.8);

  const footer = (content.scroll && content.scroll.footer) || '';
  if (footer) {
    ctx.fillStyle = 'rgba(42,35,26,0.34)';
    ctx.font = serifFont(400, smallSize * 0.92);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(footer, W / 2, H - Math.max(10, Math.round(H * 0.024)));
  }

  let dataUrl = '';
  try {
    dataUrl = canvas.toDataURL('image/webp', 0.82);
  } catch (err) {
    dataUrl = '';
  }
  if (!dataUrl || dataUrl.indexOf('data:image/webp') !== 0) {
    try {
      dataUrl = canvas.toDataURL('image/png');
    } catch (err) {
      dataUrl = '';
    }
  }
  return { canvas, dataUrl, width: W, height: H };
}

// 本机馆藏用：把画卷压到 maxEdge 内再转 webp，控制 localStorage 体积。
export function compactScrollDataUrl(dataUrl, maxEdge, quality) {
  return new Promise((resolve) => {
    if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:image/') !== 0) {
      resolve('');
      return;
    }
    const edge = Number.isFinite(maxEdge) && maxEdge > 0 ? maxEdge : 1400;
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, edge / Math.max(img.naturalWidth || edge, img.naturalHeight || edge));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(2, Math.round((img.naturalWidth || edge) * scale));
        canvas.height = Math.max(2, Math.round((img.naturalHeight || edge) * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        let out = '';
        try {
          out = canvas.toDataURL('image/webp', quality || 0.72);
        } catch (err) {
          out = '';
        }
        resolve(out && out.slice(0, 11) === 'data:image/' ? out : dataUrl);
      } catch (err) {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve('');
    img.src = dataUrl;
  });
}

export function downloadDataUrl(dataUrl, filename) {
  if (typeof dataUrl !== 'string' || !dataUrl) return false;
  try {
    const extension = dataUrl.indexOf('data:image/webp') === 0 ? '.webp' : '.png';
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = (filename || 'ink-museum-scroll') + extension;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
  } catch (err) {
    return false;
  }
}