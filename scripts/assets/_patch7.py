import io
p = r"C:\Users\samcz\Documents\deepseek-harness\default-workspace\ink-museum\scripts\assets\fetch_and_compose.py"
s = io.open(p, encoding="utf-8").read()
def rep(old, new):
    global s
    assert old in s, "NOT FOUND: " + old[:100]
    s = s.replace(old, new, 1)

# 纸纤维更淡、更柔；支持平铺环绕
rep('''def draw_fibers(img, seed, count):
    """在图上画极淡的纸纤维线（短、弯、低对比）。"""
    rng = np.random.RandomState(seed)
    w, h = img.size
    layer = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(layer)
    for _ in range(count):
        x = rng.uniform(0, w)
        y = rng.uniform(0, h)
        ln = rng.uniform(8, 90)
        ang = rng.uniform(0, np.pi)
        curl = rng.uniform(-0.35, 0.35)
        pts = []
        for k in range(6):
            t = k / 5.0
            a = ang + curl * t
            pts.append((x + np.cos(a) * ln * t, y + np.sin(a) * ln * t))
        val = int(rng.uniform(10, 26))
        d.line(pts, fill=val, width=1)
    layer = layer.filter(ImageFilter.GaussianBlur(0.6))
    arr = np.asarray(img, dtype=np.float32) / 255.0
    a = np.asarray(layer, dtype=np.float32) / 255.0
    arr = arr * (1.0 - a[..., None] * 0.55) + a[..., None] * 0.0
    return Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8))''',
'''def draw_fibers(img, seed, count, wrap=False, strength=0.28):
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
    return Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8))''')

# 纸纹平铺：环绕纤维
rep('img = draw_fibers(img, seed=4242, count=260)', 'img = draw_fibers(img, seed=4242, count=260, wrap=True, strength=0.30)')

# 图标：磨损收敛、字改楷体候选优先
rep('for _ in range(220):', 'for _ in range(110):')
rep('r = rng.uniform(6, 26)', 'r = rng.uniform(4, 16)')
rep('wear = wear.filter(ImageFilter.GaussianBlur(1.2))', 'wear = wear.filter(ImageFilter.GaussianBlur(2.0))')

io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("patch4 OK")
