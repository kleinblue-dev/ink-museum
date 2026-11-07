# -*- coding: utf-8 -*-
"""开发用：测试统一调色管线 + 生成 entry 宽幅候选 contact sheet。"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "_cache", "raw")
OUT = os.path.join(HERE, "_cache", "try"); os.makedirs(OUT, exist_ok=True)

def srgb_to_lin(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)

def lin_to_srgb(x):
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(np.clip(x, 0, 1), 1 / 2.4) - 0.055)

PAPER = np.array([0.949, 0.910, 0.847])   # #f2e8d8
INK   = np.array([0.110, 0.094, 0.075])   # #1c1813

def tonemap(im, white_pct=99.0, black_pct=1.0, midpoint=0.5, contrast=1.0, paper=PAPER, ink=INK, sharp=0.0):
    arr = np.asarray(im.convert("RGB"), dtype=np.float32) / 255.0
    lin = srgb_to_lin(arr)
    lum = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
    if sharp > 0:
        # unsharp on luminance via PIL
        l8 = np.clip(lin_to_srgb(lum) * 255, 0, 255).astype(np.uint8)
        li = Image.fromarray(l8).filter(ImageFilter.UnsharpMask(radius=1.2, percent=int(sharp * 100), threshold=2))
        lum = srgb_to_lin(np.asarray(li, dtype=np.float32) / 255.0)
    w = np.percentile(lum, white_pct)
    b = np.percentile(lum, black_pct)
    t = np.clip((lum - b) / max(w - b, 1e-6), 0.0, 1.0)
    # contrast around midpoint in t space
    t = np.clip((t - midpoint) * contrast + midpoint, 0.0, 1.0)
    t = t ** 1.02
    p = srgb_to_lin(paper.astype(np.float32))
    k = srgb_to_lin(ink.astype(np.float32))
    out = k[None, None, :] + (p - k)[None, None, :] * t[..., None]
    return lin_to_srgb(out)

def contact(items, cell_w, out_name, cols=2):
    """items: list of (label, PIL.Image 640x?)"""
    rows = (len(items) + cols - 1) // cols
    ch = int(cell_w * items[0][1].size[1] / items[0][1].size[0])
    sheet = Image.new("RGB", (cols * cell_w, rows * (ch + 20)), (25, 25, 25))
    d = ImageDraw.Draw(sheet)
    for i, (label, im) in enumerate(items):
        cx, cy = (i % cols) * cell_w, (i // cols) * (ch + 20)
        sheet.paste(im.resize((cell_w, ch), Image.LANCZOS), (cx, cy))
        d.text((cx + 6, cy + ch + 3), label, fill=(245, 245, 245))
    sheet.save(os.path.join(OUT, out_name), quality=90)
    print("wrote", out_name, sheet.size)

# entry wide candidates from long scroll
im = Image.open(os.path.join(RAW, "entry_full.jpg")).convert("RGB")
W, H = im.size
print("entry_full", im.size)
xs = [10514, 12114, 13714, 15314, 16914, 18514, 20114, 21714, 23314]
items = []
for x in xs:
    crop = im.crop((x, 0, x + 1600, 900))
    out = tonemap(crop, white_pct=99.0, black_pct=0.5)
    items.append((f"x={x}", Image.fromarray((out * 255).astype(np.uint8))))
contact(items[:8], 640, "entry_candidates.jpg", cols=2)
