# -*- coding: utf-8 -*-
"""
墨馆 · 视觉资产构建脚本（幂等 / 可复现）

把 Wikimedia Commons 公有领域宋元水墨名作，处理成统一的博物馆调性 WebP 背景；
另程序生成「收卷」宣纸底、可平铺纸纹、朱砂印章图标。

用法（在项目根 ink-museum/ 下）：
    set HTTPS_PROXY=http://127.0.0.1:7897   # 构建期下载走代理（首次）
    E:\AI\Python311\python.exe scripts\assets\fetch_and_compose.py
    ... --only entry,spring,water      # 只出某几组
    ... --force-download               # 忽略缓存重新下载
    ... --preview _cache/try           # 额外输出 900px 宽预览图（调构图用）

依赖：Pillow、numpy（SPEC §10）。脚本幂等：源图缓存于 scripts/assets/_cache/raw/，
非下载步骤逐字节确定，重复运行输出一致。
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ASSETS = os.path.join(ROOT, "assets")
BG = os.path.join(ASSETS, "bg")
ICONS = os.path.join(ASSETS, "icons")
CACHE = os.path.join(HERE, "_cache")
RAW = os.path.join(CACHE, "raw")
META_CACHE = os.path.join(CACHE, "commons-meta.json")
UA = "ink-museum-assets/1.0 (https://github.com/kleinblue-dev/ink-museum; build-time only)"
API = "https://commons.wikimedia.org/w/api.php"
FILEPATH = "https://commons.wikimedia.org/wiki/Special:FilePath/"

# ---------------------------------------------------------------- 视觉基调
PAPER = np.array([0.949, 0.910, 0.847], dtype=np.float32)   # #f2e8d8 暖纸白
INK = np.array([0.110, 0.094, 0.075], dtype=np.float32)     # #1c1813 深墨
WIDE = (1600, 900)
TALL = (900, 1440)
THUMB = (640, 420)
BUDGET = {"wide": 200 * 1024, "tall": 172 * 1024, "thumb": 57 * 1024,
          "tile": 40 * 1024, "scroll": 200 * 1024}

# ---------------------------------------------------------------- 作品配置
# box 一律为「源图归一化坐标」(l, t, r, b)，换图/换裁切只改这里。
# commons_width: 下载缩略图宽度；None = 原图。
ARTWORKS = [
    {
        "id": "entry",
        "work": {
            "title": "富春山居图（无用师卷）", "titleEn": "Dwelling in the Fuchun Mountains",
            "artist": "黄公望", "dynasty": "元", "year": "1347–1351",
            "museum": "台北故宫博物院",
        },
        "sources": [
            {"cache": "entry_full.jpg", "commons": "富春山居圖(無用師卷).jpg",
             "width": None, "expect": (26134, 900)},
        ],
        "wide": {"cache": "entry_full.jpg", "box": (0.434684, 0.0, 0.493880, 0.966667),
                 "note": "无用师卷主峰与洲渚；左缘右移 400px 避开扫描拼缝"},
        "tall": {"cache": "entry_full.jpg", "box": (0.408663, 0.0, 0.429479, 0.966667),
                 "note": "卷首远岫、江面与洲渚；下三分之一为留白水面，便于压字"},
        "tone": {"white_pct": 99.2, "black_pct": 0.4, "contrast": 1.06, "sharpen": 0.4},
    },
    {
        "id": "spring",
        "work": {
            "title": "早春图", "titleEn": "Early Spring",
            "artist": "郭熙", "dynasty": "北宋", "year": "1072（熙宁五年）",
            "museum": "台北故宫博物院",
        },
        "sources": [
            {"cache": "spring.jpg", "commons": "Guo Xi - Early Spring, upscaled.jpg",
             "width": 3840, "expect": (3840, 5609)},
        ],
        "wide": {"cache": "spring.jpg", "box": (0.090104, 0.300000, 0.900000, 0.612345),
                 "note": "中部山体与飞瀑横带；避开四周藏印与乾隆题诗"},
        "tall": {"cache": "spring.jpg", "box": (0.090104, 0.095027, 0.900000, 0.985000),
                 "note": "整幅竖轴（略去上下题印边缘），手机端满屏",
                 "finish_blur": 0.6, "tone": {"sharpen": 0.35}}, 
        "tone": {"white_pct": 99.0, "black_pct": 0.3, "contrast": 1.10, "sharpen": 0.45},
    },
    {
        "id": "water",
        "work": {
            "title": "水图 · 秋水迥波", "titleEn": "Water Album: The Waving Surface of the Autumn Flood",
            "artist": "马远", "dynasty": "南宋", "year": "12–13 世纪",
            "museum": "北京故宫博物院（册页）",
        },
        "sources": [
            {"cache": "water_wave.jpg", "commons": "Ma Yuan - Water Album - The Waving Surface of the Autumn Flood.jpg",
             "width": None, "expect": (1708, 1115),
             "seams": [513, 872, 1219]},   # 册页照片拼缝/折缝的暗线位置（源图列坐标）
        ],
        "wide": {"cache": "water_wave.jpg", "box": (0.152225, 0.179372, 1.0, 0.910314),
                 "note": "裁去左侧题名与藏印，取水波主段；上方留白",
                 "finish_blur": 0.5, "tone": {"sharpen": 0.45}},
        "tall": {"cache": "water_wave.jpg", "box": (0.204918, 0.0, 0.613021, 1.0),
                 "note": "竖裁中段水纹，手机端满屏", "finish_blur": 0.4},
        "tone": {"white_pct": 99.0, "black_pct": 0.3, "contrast": 1.12, "sharpen": 0.55},
    },
    {
        "id": "bamboo",
        "work": {
            "title": "墨竹图", "titleEn": "Ink Bamboo",
            "artist": "文同", "dynasty": "北宋", "year": "11 世纪",
            "museum": "台北故宫博物院",
        },
        "sources": [
            {"cache": "bamboo_wentong.jpg", "commons": "Wen Tong Babmbuk.jpg",
             "width": None, "expect": (1830, 2880)},
        ],
        "wide": {"cache": "bamboo_wentong.jpg", "box": (0.0, 0.205, 1.0, 0.5623),
                 "note": "裁去上部题跋，取竹枝横段；右上留白压字", "finish_blur": 0.5},
        "tall": {"cache": "bamboo_wentong.jpg", "box": (0.10, 0.222, 0.8500, 0.985),
                 "note": "竖裁竹枝主体，避开左右缘与下部藏印", "finish_blur": 0.5},
        "tone": {"white_pct": 78.0, "black_pct": 0.3, "contrast": 1.10, "sharpen": 0.45},
    },
    {
        "id": "pavilion",
        "work": {
            "title": "容膝斋图", "titleEn": "Rongxi Studio",
            "artist": "倪瓒", "dynasty": "元", "year": "1372（洪武五年）",
            "museum": "台北故宫博物院",
        },
        "sources": [
            {"cache": "pavilion.jpg",
             "commons": "Ni Zan. The Rongxi Studio.1372. 74,7x35,3. National Palace Museum, Taipei.jpg",
             "width": None, "expect": (1788, 3674)},
        ],
        "wide": {"cache": "pavilion.jpg", "box": (0.04, 0.515, 0.96, 0.7668),
                 "note": "裁去上部自题藏印，取疏林、空亭、水面；右侧留白", "finish_blur": 0.5},
        "tall": {"cache": "pavilion.jpg", "box": (0.15, 0.44, 0.7249, 0.8877),
                 "note": "竖裁疏林与空亭，亭在右下，上部留白", "finish_blur": 0.5},
        "tone": {"white_pct": 98.0, "black_pct": 0.2, "contrast": 1.16, "sharpen": 0.55},
    },
]

# ---------------------------------------------------------------- 图像工具
def srgb_to_lin(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(x):
    return np.where(x <= 0.0031308, x * 12.92,
                    1.055 * np.power(np.clip(x, 0.0, 1.0), 1.0 / 2.4) - 0.055)


def flatten_lowfreq(lum, scale=10, lo=0.86, hi=1.16):
    """除掉扫描慢变化光照场（扫描拼缝亮度台阶 / 老照片不均），保留局部笔墨对比。"""
    h, w = lum.shape
    small = np.asarray(
        Image.fromarray((np.clip(lin_to_srgb(lum), 0, 1) * 255).astype(np.uint8)).resize(
            (max(w // scale, 2), max(h // scale, 2)), Image.BOX), dtype=np.float32) / 255.0
    field = np.asarray(Image.fromarray(small).resize((w, h), Image.BICUBIC), dtype=np.float32)
    field = np.clip(field, lo * np.median(field), hi * np.median(field))
    return lum / (field / np.median(field))


def tonemap(im, white_pct=99.0, black_pct=0.3, contrast=1.08, sharpen=0.4,
            paper=PAPER, ink=INK, flatten=True, denoise=True):
    """暖纸白平衡 + 近单色双色调 + 轻暗角。返回 sRGB float [0,1] 数组。"""
    arr = np.asarray(im.convert("RGB"), dtype=np.float32) / 255.0
    lin = srgb_to_lin(arr)
    lum = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
    if denoise:
        # 亮度中值去噪：消扫描颗粒/JPEG 噪点，让「纸」更干净、WebP 也压得下来
        l8 = np.clip(lin_to_srgb(lum) * 255, 0, 255).astype(np.uint8)
        mi = Image.fromarray(l8).filter(ImageFilter.MedianFilter(3))
        lnew = srgb_to_lin(np.asarray(mi, dtype=np.float32) / 255.0)
        lin = lin * (lnew / np.maximum(lum, 1e-4))[..., None]
        lum = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
    if flatten:
        lum = flatten_lowfreq(lum)
    if sharpen > 0:
        l8 = np.clip(lin_to_srgb(lum) * 255, 0, 255).astype(np.uint8)
        li = Image.fromarray(l8).filter(
            ImageFilter.UnsharpMask(radius=1.1, percent=int(sharpen * 100), threshold=2))
        lum = srgb_to_lin(np.asarray(li, dtype=np.float32) / 255.0)
    b = float(np.percentile(lum, black_pct))
    w = float(np.percentile(lum, white_pct))
    t = np.clip((lum - b) / max(w - b, 1e-6), 0.0, 1.0)
    t = np.clip((t - 0.5) * contrast + 0.5, 0.0, 1.0) ** 1.02
    p = srgb_to_lin(np.asarray(paper, dtype=np.float32))
    k = srgb_to_lin(np.asarray(ink, dtype=np.float32))
    out = k[None, None, :] + (p - k)[None, None, :] * t[..., None]
    h, wd = out.shape[:2]
    yy, xx = np.mgrid[0:h, 0:wd].astype(np.float32)
    r2 = ((xx - wd / 2) / (wd / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2
    vig = 1.0 - 0.12 * np.clip(r2 / 2.0, 0, 1) ** 1.4
    return lin_to_srgb(np.clip(out * vig[..., None], 0, 1))


def crop_norm(im, box):
    w, h = im.size
    l, t, r, b = box
    x0, y0 = int(round(l * w)), int(round(t * h))
    x1, y1 = int(round(r * w)), int(round(b * h))
    x0, x1 = max(0, min(x0, w - 1)), max(1, min(x1, w))
    y0, y1 = max(0, min(y0, h - 1)), max(1, min(y1, h))
    return im.crop((x0, y0, x1, y1))


def heal_vertical_seams(im, seams, shift=42, half=14):
    """修补扫描/册页的竖向接缝暗线：把邻近竖条按羽化权重克隆过来。
    水图册页的水平波纹在横向近似平移不变，克隆衔接几乎不可见。"""
    if not seams:
        return im
    arr = np.asarray(im.convert("RGB"), dtype=np.float32) / 255.0
    _h, w = arr.shape[:2]
    for x in seams:
        if x - half - 12 < 0 or x + half + 12 >= w:
            continue
        src = arr[:, x - shift - half:x - shift + half, :].copy()
        t = np.linspace(0, 1, 2 * half)[None, :, None]
        feather = np.clip(np.minimum(t, 1 - t) / 0.45, 0, 1)
        arr[:, x - half:x + half, :] = (
            arr[:, x - half:x + half, :] * (1 - feather) + src * feather)
    print(f"  · 修补竖向接缝 {len(seams)} 处: {seams}")
    return Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8))


def render_tone_crop(im, box, tone, size, finish_blur=0.0):
    crop = crop_norm(im, box)
    arr = tonemap(crop, **tone)
    img = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8))
    img = img.resize(size, Image.LANCZOS)
    if finish_blur > 0:
        # 末道柔化：只削极高频纸纹，换取更干净的压缩；随后轻微回锐保墨线
        img = img.filter(ImageFilter.GaussianBlur(finish_blur))
        img = img.filter(ImageFilter.UnsharpMask(radius=1.0, percent=35, threshold=2))
    return img


def encode_webp(img, quality):
    import io
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=quality, method=6)
    return buf.getvalue()


def save_webp_budget(img, path, max_bytes, qmin=55, qmax=95):
    """二分找「不超过预算的最高质量」，保证体积达标。返回 (quality, bytes)。"""
    best_q, best_data = None, None
    lo, hi = qmin, qmax
    while lo <= hi:
        q = (lo + hi) // 2
        data = encode_webp(img, q)
        if len(data) <= max_bytes:
            best_q, best_data = q, data
            lo = q + 1
        else:
            hi = q - 1
    if best_data is None:
        best_q = qmin
        best_data = encode_webp(img, qmin)
        print(f"  !! {os.path.basename(path)} 无法压到预算内: {len(best_data)/1024:.0f}KB")
    with open(path, "wb") as f:
        f.write(best_data)
    return best_q, len(best_data)


def make_thumb(wide_img):
    """从最终 wide（1600x900）再裁 640:420，再缩。"""
    w, h = wide_img.size
    th = h
    tw = int(round(h * THUMB[0] / THUMB[1]))
    x = (w - tw) // 2
    return wide_img.crop((x, 0, x + tw, th)).resize(THUMB, Image.LANCZOS)


# ---------------------------------------------------------------- 下载与出处
def _api(params, tries=5):
    params = dict(params, format="json")
    url = API + "?" + urllib.parse.urlencode(params)
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:  # 429 等，退避重试
            last = e
            time.sleep(5 * (i + 1))
    raise RuntimeError(f"Commons API 失败: {last}")


def commons_meta(title):
    """取文件页信息：尺寸、直链、许可证、作者（用于 CREDITS）。带本地缓存，重跑不重复请求。"""
    cache = {}
    if os.path.exists(META_CACHE):
        try:
            with open(META_CACHE, encoding="utf-8") as f:
                cache = json.load(f)
        except Exception:
            cache = {}
    if title in cache and cache[title].get("license"):
        return cache[title]
    try:
        data = _api({"action": "query", "titles": "File:" + title, "prop": "imageinfo",
                     "iiprop": "url|size|mime|extmetadata"})
        pages = data.get("query", {}).get("pages", {})
        for p in pages.values():
            if p.get("missing") is not None:
                continue
            ii = p.get("imageinfo", [{}])[0]
            if not ii:
                continue
            em = ii.get("extmetadata", {})

            def _strip(h):
                return re.sub(r"<[^>]+>", "", h or "").strip()

            rec = {
                "fileTitle": "File:" + title,
                "pageUrl": "https://commons.wikimedia.org/wiki/File:" + urllib.parse.quote(title.replace(" ", "_")),
                "fileUrl": ii.get("url", "").split("?")[0],
                "width": ii.get("width"), "height": ii.get("height"), "mime": ii.get("mime"),
                "bytes": ii.get("size"),
                "license": _strip(em.get("LicenseShortName", {}).get("value", "")),
                "licenseUrl": _strip(em.get("LicenseUrl", {}).get("value", "")),
                "artistMeta": _strip(em.get("Artist", {}).get("value", ""))[:200],
                "dateMeta": _strip(em.get("DateTimeOriginal", {}).get("value", ""))[:100],
                "credit": _strip(em.get("Credit", {}).get("value", ""))[:200],
            }
            cache[title] = rec
            try:
                os.makedirs(CACHE, exist_ok=True)
                with open(META_CACHE, "w", encoding="utf-8") as f:
                    json.dump(cache, f, ensure_ascii=False, indent=1)
            except Exception:
                pass
            return rec
    except Exception as e:
        print(f"  !! 元数据获取失败 {title}: {e}")
    return {"fileTitle": "File:" + title,
            "pageUrl": "https://commons.wikimedia.org/wiki/File:" + urllib.parse.quote(title.replace(" ", "_"))}


def download(cache_name, commons_title, width, force=False, expect=None):
    path = os.path.join(RAW, cache_name)
    if os.path.exists(path) and os.path.getsize(path) > 1024 and not force:
        try:
            with Image.open(path) as im:
                dims = im.size
            if expect and dims != tuple(expect):
                raise RuntimeError(
                    f"缓存 {cache_name} 尺寸 {dims} != 预期 {expect}；若删除缓存重下，请同步更新配置")
            print(f"  · 缓存命中 {cache_name} {dims[0]}x{dims[1]}")
            return path
        except Exception:
            pass
    os.makedirs(RAW, exist_ok=True)
    url = FILEPATH + urllib.parse.quote(commons_title, safe="")
    if width:
        url += f"?width={width}"
    last = None
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=240) as r:
                data = r.read()
            if len(data) < 1024:
                raise RuntimeError("响应过小")
            with open(path, "wb") as f:
                f.write(data)
            print(f"  · 下载 {cache_name} {len(data)/1024:.0f}KB")
            return path
        except Exception as e:
            last = e
            time.sleep(5 * (i + 1))
    raise RuntimeError(f"下载失败 {commons_title}: {last}（构建期请设置 HTTPS_PROXY）")


# ---------------------------------------------------------------- 程序生成：纸
def fft_noise(w, h, seed, feature=2.0):
    """FFT 低通随机场（周期化，可无缝平铺），归一化到 [0,1]。"""
    rng = np.random.RandomState(seed)
    noise = rng.rand(h, w).astype(np.float32)
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    r = np.sqrt(fx ** 2 + fy ** 2)
    r[0, 0] = 1e-6
    filt = 1.0 / np.power(r, feature)
    filt[0, 0] = 0.0
    field = np.real(np.fft.ifft2(np.fft.fft2(noise) * filt))
    field -= field.min()
    field /= max(field.max(), 1e-6)
    return field.astype(np.float32)


def paper_base(w, h, seed, grain=0.022, mottle=0.035):
    """宣纸底：暖纸白 + 低频云斑 + 细纤维颗粒（周期连续，可平铺）。"""
    coarse = fft_noise(w, h, seed + 1, feature=2.6)
    fine = fft_noise(w, h, seed + 2, feature=1.15)
    field = 1.0 + mottle * (coarse - 0.5) + grain * (fine - 0.5)
    rgb = PAPER[None, None, :] * field[..., None]
    # 极轻暖色偏：右下略暖一点
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    warm = (xx / max(w - 1, 1)) * 0.012 + (yy / max(h - 1, 1)) * 0.008
    rgb[..., 2] *= (1.0 - warm)
    rgb[..., 1] *= (1.0 - 0.35 * warm)
    return np.clip(rgb, 0, 1)


def draw_fibers(img, seed, count, wrap=False, strength=0.28):
    """在图上画极淡的纸纤维线（短、弯、低对比）。wrap=True 时四周环绕绘制，保证可平铺。"""
    rng = np.random.RandomState(seed)
    w, h = img.size
    layer = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(layer)
    for _ in range(count):
        x = rng.uniform(0, w)
        y = rng.uniform(0, h)
        ln = rng.uniform(10, 110)
        ang = rng.uniform(0, np.pi)
        curl = rng.uniform(-0.4, 0.4)
        base = []
        for k in range(6):
            t = k / 5.0
            a = ang + curl * t
            base.append((x + np.cos(a) * ln * t, y + np.sin(a) * ln * t))
        val = int(rng.uniform(8, 22))
        offsets = [(0, 0)]
        if wrap:
            offsets = [(dx, dy) for dx in (-w, 0, w) for dy in (-h, 0, h)]
        for dx, dy in offsets:
            d.line([(px + dx, py + dy) for px, py in base], fill=val, width=1)
    layer = layer.filter(ImageFilter.GaussianBlur(1.1))
    arr = np.asarray(img, dtype=np.float32) / 255.0
    a = np.asarray(layer, dtype=np.float32) / 255.0
    arr = arr * (1.0 - a[..., None] * strength)
    return Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8))


def add_vignette(img, strength=0.08):
    arr = np.asarray(img, dtype=np.float32) / 255.0
    h, w = arr.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    r2 = ((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2
    vig = 1.0 - strength * np.clip(r2 / 2.0, 0, 1) ** 1.3
    arr = arr * vig[..., None]
    return Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8))


def build_scroll():
    """收卷底：整幅宣纸。无字、无图案，供画卷预览叠墨迹与落款。"""
    out = []
    for name, size in (("scroll-wide.webp", WIDE), ("scroll-tall.webp", TALL)):
        w, h = size
        arr = paper_base(w, h, seed=20260)
        img = Image.fromarray((arr * 255 + 0.5).astype(np.uint8))
        img = draw_fibers(img, seed=717, count=int(w * h / 1800), strength=0.60)
        img = add_vignette(img, strength=0.07)
        path = os.path.join(BG, name)
        q, n = save_webp_budget(img, path, BUDGET["scroll"])
        out.append((name, img.size, q, n))
    return out


def build_tile():
    """assets/paper-tile.webp：512×512 无缝平铺纸纹。"""
    size = 512
    arr = paper_base(size, size, seed=90210, grain=0.030, mottle=0.045)
    img = Image.fromarray((arr * 255 + 0.5).astype(np.uint8))
    img = draw_fibers(img, seed=4242, count=380, wrap=True, strength=0.60)
    path = os.path.join(ASSETS, "paper-tile.webp")
    q, n = save_webp_budget(img, path, BUDGET["tile"])
    return ("paper-tile.webp", img.size, q, n)


# ---------------------------------------------------------------- 程序生成：图标
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\simkai.ttf",     # 楷体：接近书写感
    r"C:\Windows\Fonts\simsun.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
]
VERMILION = (158, 59, 46)     # #9e3b2e 朱砂
PAPER_RGB = (242, 232, 216)


def _font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def build_icons():
    """朱砂印章「墨」风格 PWA 图标（纸底 + 印章 + 阴文「墨」）。"""
    S = 1024
    rng = np.random.RandomState(1357)
    # 纸底
    arr = paper_base(S, S, seed=555)
    base = Image.fromarray((arr * 255 + 0.5).astype(np.uint8))
    base = draw_fibers(base, seed=888, count=1100)

    seal_size = int(S * 0.70)
    pad = (S - seal_size) // 2
    # 印章遮罩：实心方章 + 边缘磨损
    mask = Image.new("L", (S, S), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([pad, pad, pad + seal_size, pad + seal_size], radius=int(seal_size * 0.045), fill=255)
    # 磨损：边缘随机缺口
    wear = Image.new("L", (S, S), 0)
    wd = ImageDraw.Draw(wear)
    for _ in range(110):
        side = rng.randint(0, 4)
        t = rng.uniform(0.02, 0.98)
        r = rng.uniform(4, 16)
        if side == 0:
            cx, cy = pad + t * seal_size, pad + rng.uniform(-1, 1) * 6
        elif side == 1:
            cx, cy = pad + t * seal_size, pad + seal_size + rng.uniform(-1, 1) * 6
        elif side == 2:
            cx, cy = pad + rng.uniform(-1, 1) * 6, pad + t * seal_size
        else:
            cx, cy = pad + seal_size + rng.uniform(-1, 1) * 6, pad + t * seal_size
        wd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    wear = wear.filter(ImageFilter.GaussianBlur(2.0))
    mask = Image.fromarray(np.clip(np.asarray(mask, np.float32) - np.asarray(wear, np.float32), 0, 255).astype(np.uint8))
    mask = mask.filter(ImageFilter.GaussianBlur(0.8))

    # 阴文「墨」：字挖掉变成纸色
    glyph_mask = Image.new("L", (S, S), 0)
    gd = ImageDraw.Draw(glyph_mask)
    font = _font(int(seal_size * 0.66))
    text = "墨"
    bb = gd.textbbox((0, 0), text, font=font)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    gd.text(((S - tw) / 2 - bb[0], (S - th) / 2 - bb[1] - seal_size * 0.015), text, font=font, fill=255)
    glyph_mask = glyph_mask.filter(ImageFilter.GaussianBlur(1.0))
    inner = Image.fromarray(np.clip(np.asarray(mask, np.float32) - np.asarray(glyph_mask, np.float32), 0, 255).astype(np.uint8))

    # 印章层：朱砂 + 斑驳
    seal_rgb = np.zeros((S, S, 3), np.float32)
    seal_rgb[..., 0] = VERMILION[0] / 255.0
    seal_rgb[..., 1] = VERMILION[1] / 255.0
    seal_rgb[..., 2] = VERMILION[2] / 255.0
    speck = fft_noise(S, S, 2024, feature=1.05)
    seal_rgb *= (0.93 + 0.14 * speck)[..., None]
    # 轻微旋转
    seal_layer = Image.fromarray((np.clip(seal_rgb, 0, 1) * 255).astype(np.uint8))
    seal_alpha = inner.rotate(-2.4, resample=Image.BICUBIC, center=(S / 2, S / 2))
    base_arr = np.asarray(base, np.float32) / 255.0
    seal_arr = np.asarray(seal_layer, np.float32) / 255.0
    a = np.asarray(seal_alpha, np.float32)[..., None] / 255.0
    out = base_arr * (1 - a) + seal_arr * a
    out = np.clip(out, 0, 1)
    master = Image.fromarray((out * 255 + 0.5).astype(np.uint8))
    master = master.filter(ImageFilter.GaussianBlur(0.4))

    results = []
    for name, size in (("icon-512.png", 512), ("icon-192.png", 192)):
        img = master.resize((size, size), Image.LANCZOS)
        path = os.path.join(ICONS, name)
        img.save(path, "PNG", optimize=True)
        results.append((name, img.size, None, os.path.getsize(path)))
    return results


# ---------------------------------------------------------------- 构建流程
def build_artwork(cfg):
    print(f"\n== {cfg['id']}  {cfg['work']['artist']}《{cfg['work']['title']}》")
    sources = {}
    for s in cfg["sources"]:
        p = download(s["cache"], s["commons"], s.get("width"), FLAGS.force_download, s.get("expect"))
        with Image.open(p) as im:
            img = im.convert("RGB").copy()
            print(f"  源 {s['cache']} {im.size[0]}x{im.size[1]}")
        if s.get("seams"):
            img = heal_vertical_seams(img, s["seams"])
        sources[s["cache"]] = img

    def derive(kind, size):
        spec = cfg[kind]
        t = dict(cfg["tone"])
        t.update(spec.get("tone", {}))
        src = sources[spec["cache"]]
        return render_tone_crop(src, spec["box"], t, size, spec.get("finish_blur", 0.0))

    wide_img = derive("wide", WIDE)
    wide_path = os.path.join(BG, f"{cfg['id']}-wide.webp")
    wq, wn = save_webp_budget(wide_img, wide_path, BUDGET["wide"])

    tall_img = derive("tall", TALL)
    tall_path = os.path.join(BG, f"{cfg['id']}-tall.webp")
    tq, tn = save_webp_budget(tall_img, tall_path, BUDGET["tall"])

    thumb_img = make_thumb(wide_img)
    thumb_path = os.path.join(BG, f"{cfg['id']}-thumb.webp")
    qq, qn = save_webp_budget(thumb_img, thumb_path, BUDGET["thumb"])

    if FLAGS.preview:
        os.makedirs(FLAGS.preview, exist_ok=True)
        wide_img.resize((900, 506), Image.LANCZOS).save(
            os.path.join(FLAGS.preview, f"{cfg['id']}-wide-preview.jpg"), quality=88)
        tall_img.resize((450, 720), Image.LANCZOS).save(
            os.path.join(FLAGS.preview, f"{cfg['id']}-tall-preview.jpg"), quality=88)
        thumb_img.save(os.path.join(FLAGS.preview, f"{cfg['id']}-thumb-preview.jpg"), quality=88)

    tw = int(round(WIDE[1] * THUMB[0] / THUMB[1]))
    thumb_box = ((WIDE[0] - tw) / 2 / WIDE[0], 0.0, (WIDE[0] + tw) / 2 / WIDE[0], 1.0)
    rows = []
    for label, path, img, q, n in (
        ("wide", wide_path, wide_img, wq, wn),
        ("tall", tall_path, tall_img, tq, tn),
        ("thumb", thumb_path, thumb_img, qq, qn),
    ):
        budget = BUDGET[label]
        flag = "OK" if n <= budget else "OVER"
        print(f"  {os.path.basename(path):24s} {img.size[0]}x{img.size[1]}  {n/1024:7.1f}KB  q={q}  {flag}")
        if label in cfg:
            crop, note = list(cfg[label]["box"]), cfg[label]["note"]
        else:
            crop, note = list(thumb_box), "由 wide 中裁 640:420 后缩到 640x420"
        rows.append({"kind": label, "file": os.path.relpath(path, ROOT).replace("\\", "/"),
                     "width": img.size[0], "height": img.size[1], "bytes": n,
                     "quality": q, "budgetBytes": budget, "ok": n <= budget,
                     "crop": crop, "note": note})
    return rows


def write_credits(entries):
    """assets/CREDITS.json：机器可读出处与产物清单。"""
    doc = {
        "schemaVersion": "1.0.0",
        "project": "ink-museum",
        "note": "背景取自 Wikimedia Commons 公有领域（PD-old / PD-Art / CC0）宋元水墨名作；"
                "裁切、去题跋藏印、修补扫描/册页竖缝、暖纸白平衡、近单色、轻暗角由 scripts/assets/fetch_and_compose.py 完成。"
                "程序生成部分（宣纸底 / 纸纹 / 图标）不涉第三方版权。",
        "assets": entries,
    }
    path = os.path.join(ASSETS, "CREDITS.json")
    # 与已有清单合并：--only 局部重建时不会把其它条目的出处丢掉
    merged = {}
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                for e in json.load(f).get("assets", []):
                    merged[e["id"]] = e
        except Exception:
            merged = {}
    for e in entries:
        merged[e["id"]] = e
    order = [a["id"] for a in ARTWORKS] + ["scroll", "paper-tile", "icons"]
    doc["assets"] = [merged[k] for k in order if k in merged]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"\n出处写入 {os.path.relpath(path, ROOT)}")


def main():
    ap = argparse.ArgumentParser(description="墨馆视觉资产构建（幂等）")
    ap.add_argument("--only", default="", help="逗号分隔：entry,spring,water,bamboo,pavilion,scroll,tile,icons")
    ap.add_argument("--force-download", action="store_true", help="忽略缓存重新下载源图")
    ap.add_argument("--preview", default="", help="输出预览图的目录（调构图用）")
    global FLAGS
    FLAGS = ap.parse_args()
    only = [s.strip() for s in FLAGS.only.split(",") if s.strip()] or None
    os.makedirs(BG, exist_ok=True)
    os.makedirs(ICONS, exist_ok=True)
    os.makedirs(CACHE, exist_ok=True)

    print("墨馆 · 资产构建  root=" + ROOT)
    if not (os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")):
        print("  提示：首次下载需代理，如 $env:HTTPS_PROXY='http://127.0.0.1:7897'")

    entries = []
    generated = {"scroll": [], "tile": None, "icons": []}
    for cfg in ARTWORKS:
        if only and cfg["id"] not in only:
            continue
        try:
            rows = build_artwork(cfg)
        except Exception as e:
            print(f"  !! {cfg['id']} 失败: {e}")
            raise SystemExit(1)
        meta = {"id": cfg["id"], "work": cfg["work"],
                "sources": [dict(commons_meta(s["commons"]),
                                 cache=s["cache"],
                                 downloadWidth=s.get("width")) for s in cfg["sources"]],
                "license": "PD-Art / PD-old（公有领域）",
                "processing": [
                    "裁去色卡/边框/装裱/题跋/藏印区域（裁切框见 derivatives[].crop 归一化坐标）",
                    "竖向扫描/册页接缝以邻近纹理克隆修补（水图）",
                    "低通光照场校正（去扫描拼缝亮度台阶与老照片光照不均）",
                    "暖纸白平衡 + 近单色双色调（纸白 #f2e8d8 / 深墨 #1c1813）",
                    "亮度中值去噪（保留墨线边缘）；轻度锐化；暗角 ≤12%",
                    "出图前做轻柔化（只削极高频纸纹）以达标体积，观感保持墨线清晰",
                    "不添加任何文字/水印",
                ],
                "derivatives": rows}
        entries.append(meta)

    if not only or "scroll" in only:
        rows = build_scroll()
        for label, (name, size, q, n) in zip(("wide", "tall"), rows):
            print(f"  {name:24s} {size[0]}x{size[1]}  {n/1024:7.1f}KB  q={q}")
        entries.append({
            "id": "scroll", "work": {"title": "收卷底 · 宣纸", "titleEn": "Paper ground",
                                     "artist": "程序生成", "dynasty": "—", "museum": "—",
                                     "generatedBy": "scripts/assets/fetch_and_compose.py"},
            "license": "程序生成，无第三方权利",
            "processing": ["FFT 低通噪声云斑 + 纸纤维线 + 轻暗角，逐字节确定"],
            "derivatives": [{"kind": label, "file": f"assets/bg/{name}",
                             "width": size[0], "height": size[1], "bytes": n, "quality": q,
                             "budgetBytes": BUDGET["scroll"], "ok": n <= BUDGET["scroll"]}
                            for label, (name, size, q, n) in zip(("wide", "tall"), rows)],
        })
    if not only or "tile" in only:
        name, size, q, n = build_tile()
        print(f"  {name:24s} {size[0]}x{size[1]}  {n/1024:7.1f}KB  q={q}")
        entries.append({
            "id": "paper-tile", "work": {"title": "纸纹平铺贴图", "artist": "程序生成",
                                          "generatedBy": "scripts/assets/fetch_and_compose.py"},
            "license": "程序生成，无第三方权利",
            "processing": ["周期化 FFT 噪声（可无缝平铺）+ 纸纤维线"],
            "derivatives": [{"kind": "tile", "file": "assets/paper-tile.webp",
                             "width": size[0], "height": size[1], "bytes": n, "quality": q,
                             "budgetBytes": BUDGET["tile"], "ok": n <= BUDGET["tile"]}],
        })
    if not only or "icons" in only:
        rows = build_icons()
        for name, size, q, n in rows:
            print(f"  {name:24s} {size[0]}x{size[1]}  {n/1024:7.1f}KB")
        entries.append({
            "id": "icons", "work": {"title": "朱砂印章「墨」图标", "artist": "程序生成",
                                    "generatedBy": "scripts/assets/fetch_and_compose.py"},
            "license": "程序生成，无第三方权利",
            "processing": ["纸底 + 朱砂方章（随机磨损）+ 阴文「墨」+ 轻微旋转；PIL 程序绘制"],
            "derivatives": [{"kind": "icon", "file": f"assets/icons/{name}",
                             "width": size[0], "height": size[1], "bytes": n} for name, size, q, n in rows],
        })

    write_credits(entries)

    over = [d for e in entries for d in e["derivatives"] if not d.get("ok", True)]
    print("\n完成。" + (f" 超预算 {len(over)} 项!" if over else " 全部在预算内。"))
    sys.exit(0 if not over else 2)


if __name__ == "__main__":
    main()
