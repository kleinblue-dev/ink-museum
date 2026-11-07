import io
p = r"C:\Users\samcz\Documents\deepseek-harness\default-workspace\ink-museum\scripts\assets\fetch_and_compose.py"
s = io.open(p, encoding="utf-8").read()
def rep(old, new):
    global s
    assert old in s, "NOT FOUND: " + old[:100]
    s = s.replace(old, new, 1)

rep('''def render_tone_crop(im, box, tone, size, finish_blur=0.0):''',
'''def heal_vertical_seams(im, seams, shift=42, half=14):
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


def render_tone_crop(im, box, tone, size, finish_blur=0.0):''')

rep('''    sources = {}
    for s in cfg["sources"]:
        p = download(s["cache"], s["commons"], s.get("width"), FLAGS.force_download, s.get("expect"))
        with Image.open(p) as im:
            sources[s["cache"]] = im.convert("RGB").copy()
            print(f"  源 {s['cache']} {im.size[0]}x{im.size[1]}")''',
'''    sources = {}
    for s in cfg["sources"]:
        p = download(s["cache"], s["commons"], s.get("width"), FLAGS.force_download, s.get("expect"))
        with Image.open(p) as im:
            img = im.convert("RGB").copy()
            print(f"  源 {s['cache']} {im.size[0]}x{im.size[1]}")
        if s.get("seams"):
            img = heal_vertical_seams(img, s["seams"])
        sources[s["cache"]] = img''')

rep('''            {"cache": "water_wave.jpg", "commons": "Ma Yuan - Water Album - The Waving Surface of the Autumn Flood.jpg",
             "width": None, "expect": (1708, 1115)},''',
'''            {"cache": "water_wave.jpg", "commons": "Ma Yuan - Water Album - The Waving Surface of the Autumn Flood.jpg",
             "width": None, "expect": (1708, 1115),
             "seams": [513, 872, 1219]},   # 册页照片拼缝/折缝的暗线位置（源图列坐标）''')

rep('"裁切、去题跋藏印、暖纸白平衡、近单色、轻暗角由 scripts/assets/fetch_and_compose.py 完成。"',
    '"裁切、去题跋藏印、修补扫描/册页竖缝、暖纸白平衡、近单色、轻暗角由 scripts/assets/fetch_and_compose.py 完成。"')

rep('"裁去色卡/边框/装裱/题跋/藏印区域（裁切框见 derivatives[].crop 归一化坐标）",',
    '"裁去色卡/边框/装裱/题跋/藏印区域（裁切框见 derivatives[].crop 归一化坐标）",\n                    "竖向扫描/册页接缝以邻近纹理克隆修补（水图）",')

io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("patched3 OK")
