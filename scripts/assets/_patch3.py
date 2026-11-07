import io
p = r"C:\Users\samcz\Documents\deepseek-harness\default-workspace\ink-museum\scripts\assets\fetch_and_compose.py"
s = io.open(p, encoding="utf-8").read()

def rep(old, new):
    global s
    assert old in s, "NOT FOUND: " + old[:100]
    s = s.replace(old, new, 1)

# 1) 预算收紧：wide ≤200KB、tall ≤172KB、thumb ≤57KB（留出余量，SPEC 上限是 220/180/60）
rep('BUDGET = {"wide": 220 * 1024, "tall": 180 * 1024, "thumb": 60 * 1024,\n          "tile": 40 * 1024, "scroll": 220 * 1024}',
    'BUDGET = {"wide": 200 * 1024, "tall": 172 * 1024, "thumb": 57 * 1024,\n          "tile": 40 * 1024, "scroll": 200 * 1024}')

# 2) render_tone_crop 支持「出图后轻柔化」（压体积用，观感几乎无损）
rep('''def render_tone_crop(im, box, tone, size):
    crop = crop_norm(im, box)
    arr = tonemap(crop, **tone)
    img = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8))
    return img.resize(size, Image.LANCZOS)''',
'''def render_tone_crop(im, box, tone, size, finish_blur=0.0):
    crop = crop_norm(im, box)
    arr = tonemap(crop, **tone)
    img = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8))
    img = img.resize(size, Image.LANCZOS)
    if finish_blur > 0:
        # 末道柔化：只削极高频纸纹，换取更干净的压缩；随后轻微回锐保墨线
        img = img.filter(ImageFilter.GaussianBlur(finish_blur))
        img = img.filter(ImageFilter.UnsharpMask(radius=1.0, percent=35, threshold=2))
    return img''')

# 3) build_artwork：每个衍生规格可覆盖 tone / finish_blur
rep('''    tone = cfg["tone"]
    wide_src = sources[cfg["wide"]["cache"]]
    wide_img = render_tone_crop(wide_src, cfg["wide"]["box"], tone, WIDE)''',
'''    def derive(kind, size):
        spec = cfg[kind]
        t = dict(cfg["tone"])
        t.update(spec.get("tone", {}))
        src = sources[spec["cache"]]
        return render_tone_crop(src, spec["box"], t, size, spec.get("finish_blur", 0.0))

    wide_img = derive("wide", WIDE)''')
rep('''    tall_src = sources[cfg["tall"]["cache"]]
    tall_img = render_tone_crop(tall_src, cfg["tall"]["box"], tone, TALL)''',
'''    tall_img = derive("tall", TALL)''')

# 4) 各作品按需加 finish_blur / 覆盖 tone
rep('''        "tall": {"cache": "spring.jpg", "box": (0.090104, 0.095027, 0.900000, 0.985000),
                 "note": "整幅竖轴（略去上下题印边缘），手机端满屏"},''',
'''        "tall": {"cache": "spring.jpg", "box": (0.090104, 0.095027, 0.900000, 0.985000),
                 "note": "整幅竖轴（略去上下题印边缘），手机端满屏",
                 "finish_blur": 0.6, "tone": {"sharpen": 0.35}}, ''')
rep('''        "wide": {"cache": "water_wave.jpg", "box": (0.152225, 0.179372, 1.0, 0.910314),
                 "note": "裁去左侧题名与藏印，取水波主段；上方留白"},''',
'''        "wide": {"cache": "water_wave.jpg", "box": (0.152225, 0.179372, 1.0, 0.910314),
                 "note": "裁去左侧题名与藏印，取水波主段；上方留白",
                 "finish_blur": 0.5, "tone": {"sharpen": 0.45}},''')
rep('''        "tall": {"cache": "water_wave.jpg", "box": (0.204918, 0.0, 0.613021, 1.0),
                 "note": "竖裁中段水纹，手机端满屏"},''',
'''        "tall": {"cache": "water_wave.jpg", "box": (0.204918, 0.0, 0.613021, 1.0),
                 "note": "竖裁中段水纹，手机端满屏", "finish_blur": 0.4},''')

# 5) 处理说明补充
rep('"不添加任何文字/水印",',
    '"出图前做轻柔化（只削极高频纸纹）以达标体积，观感保持墨线清晰",\n                    "不添加任何文字/水印",')

io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("patched2 OK")
