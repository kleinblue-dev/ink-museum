# -*- coding: utf-8 -*-
"""生成源图预览：长卷按窗口做 contact sheet，竖轴缩到宽 650。"""
import os, sys
from PIL import Image, ImageDraw
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_cache")
RAW = os.path.join(CACHE, "raw")
OUT = os.path.join(CACHE, "preview"); os.makedirs(OUT, exist_ok=True)

def save_contact(name, im, cols, cell_w, cell_h):
    # im: full long image; slice into cols*rows windows
    n = cols * 2
    windows = []
    W, H = im.size
    for i in range(n):
        x = int(i * (W - cell_w * H / cell_h) / (n - 1)) if n > 1 else 0
        # window width in src = cell_w * (H/cell_h)
        ww = int(cell_w * H / cell_h)
        windows.append(im.crop((x, 0, min(x + ww, W), H)).resize((cell_w, cell_h), Image.LANCZOS))
    sheet = Image.new("RGB", (cols * cell_w, 2 * (cell_h + 22)), (30, 30, 30))
    d = ImageDraw.Draw(sheet)
    for i, w in enumerate(windows):
        cx, cy = (i % cols) * cell_w, (i // cols) * (cell_h + 22)
        sheet.paste(w, (cx, cy))
        d.text((cx + 6, cy + cell_h + 4), f"win{i} x={int(i*(W-ww)/(n-1)) if n>1 else 0}", fill=(240, 240, 240))
    sheet.save(os.path.join(OUT, name), quality=88)
    print("wrote", name, sheet.size)

def save_fit(name, path, width=650):
    im = Image.open(path).convert("RGB")
    im.thumbnail((width, 4000), Image.LANCZOS)
    im.save(os.path.join(OUT, name), quality=90)
    print("wrote", name, im.size)

files = os.listdir(RAW) if os.path.isdir(RAW) else []
print("raw:", files)
for f in files:
    p = os.path.join(RAW, f)
    try:
        if f == "entry_full.jpg":
            im = Image.open(p).convert("RGB")
            save_contact("entry_windows.jpg", im, 4, 480, 270)
        elif f in ("entry_alt_thumb.png", "entry_detail.jpg"):
            save_fit("entry_alt.jpg", p, 900)
        else:
            save_fit(f.rsplit(".", 1)[0] + ".jpg", p, 650)
    except Exception as e:
        print("ERR", f, e)
