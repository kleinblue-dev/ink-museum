# -*- coding: utf-8 -*-
"""对 fetch_and_compose.py 打补丁：denoise、thumb 记录 bug、entry 裁切、pavilion 比例、元数据缓存。"""
import io, re, sys
p = r"C:\Users\samcz\Documents\deepseek-harness\default-workspace\ink-museum\scripts\assets\fetch_and_compose.py"
src = io.open(p, encoding="utf-8").read()

def rep(old, new, count=1):
    global src
    assert old in src, "NOT FOUND: " + old[:80]
    src = src.replace(old, new, count)

# 1) tonemap 加 med3 去噪（扫描颗粒会让 WebP 压不下来；同时更接近「干净纸」）
rep(
'''def tonemap(im, white_pct=99.0, black_pct=0.3, contrast=1.08, sharpen=0.4,
            paper=PAPER, ink=INK, flatten=True):
    """暖纸白平衡 + 近单色双色调 + 轻暗角。返回 sRGB float [0,1] 数组。"""
    arr = np.asarray(im.convert("RGB"), dtype=np.float32) / 255.0
    lin = srgb_to_lin(arr)
    lum = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
    if flatten:''',
'''def tonemap(im, white_pct=99.0, black_pct=0.3, contrast=1.08, sharpen=0.4,
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
    if flatten:''')

# 2) palette 增加缓存目录常量（元数据缓存）
rep('RAW = os.path.join(CACHE, "raw")',
    'RAW = os.path.join(CACHE, "raw")\nMETA_CACHE = os.path.join(CACHE, "commons-meta.json")')

# 3) commons_meta 读/写缓存
rep(
'''def commons_meta(title):
    """取文件页信息：尺寸、直链、许可证、作者（用于 CREDITS）。"""
    try:''',
'''def commons_meta(title):
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
    try:''')
rep(
'''            return {
                "fileTitle": "File:" + title,''',
'''            em = ii.get("extmetadata", {})

            def _strip(h):
                return re.sub(r"<[^>]+>", "", h or "").strip()

            rec = {
                "fileTitle": "File:" + title,''')
rep(
'''                "width": ii.get("width"), "height": ii.get("height"), "mime": ii.get("mime"),
                "bytes": ii.get("size"),
            }''',
'''                "width": ii.get("width"), "height": ii.get("height"), "mime": ii.get("mime"),
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
            return rec''')

# 4) 需要 re 模块
rep("import os\nimport sys", "import os\nimport re\nimport sys")

# 5) thumb 记录 bug：thumb 没有 cfg["thumb"]["box"]
rep(
'''    rows = []
    for label, path, img, q, n in (
        ("wide", wide_path, wide_img, wq, wn),
        ("tall", tall_path, tall_img, tq, tn),
        ("thumb", thumb_path, thumb_img, qq, qn),
    ):
        budget = BUDGET[label]
        flag = "OK" if n <= budget else "OVER"
        print(f"  {os.path.basename(path):24s} {img.size[0]}x{img.size[1]}  {n/1024:7.1f}KB  q={q}  {flag}")
        rows.append({"kind": label, "file": os.path.relpath(path, ROOT).replace("\\\\", "/"),
                     "width": img.size[0], "height": img.size[1], "bytes": n,
                     "quality": q, "budgetBytes": budget, "ok": n <= budget,
                     "crop": list(cfg[label]["box"]), "note": cfg[label]["note"]})
    return rows''',
'''    tw = int(round(WIDE[1] * THUMB[0] / THUMB[1]))
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
        rows.append({"kind": label, "file": os.path.relpath(path, ROOT).replace("\\\\", "/"),
                     "width": img.size[0], "height": img.size[1], "bytes": n,
                     "quality": q, "budgetBytes": budget, "ok": n <= budget,
                     "crop": crop, "note": note})
    return rows''')

# 6) entry 配置：只留无用师卷；wide 右移避接缝；tall 改用卷中留白水岸段（同一扫描，无混源）
entry_old = src[src.index('    {\n        "id": "entry",'):src.index('    {\n        "id": "spring",')]
entry_new = '''    {
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
'''
src = src.replace(entry_old, entry_new)

# 7) pavilion wide 比例修正（16:9）
rep('"wide": {"cache": "pavilion.jpg", "box": (0.040000, 0.380000, 0.960000, 0.897500),',
    '"wide": {"cache": "pavilion.jpg", "box": (0.040000, 0.380000, 0.960000, 0.631900),')

# 8) bamboo tall 比例精确到 0.625
rep('"tall": {"cache": "bamboo_wentong.jpg", "box": (0.187500, 0.210000, 0.750000, 0.778500),',
    '"tall": {"cache": "bamboo_wentong.jpg", "box": (0.187500, 0.210000, 0.750000, 0.782100),')

# 9) 处理说明补一条
rep('"轻度锐化保墨线清晰；暗角 ≤12%",',
    '"亮度中值去噪（保留墨线边缘）；轻度锐化；暗角 ≤12%",')

io.open(p, "w", encoding="utf-8", newline="\n").write(src)
print("patched OK", len(src))
