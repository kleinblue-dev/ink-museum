# -*- coding: utf-8 -*-
"""v2：加入低通光照场校正（消扫描拼缝/暗角），测试 entry 构图候选。"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "_cache", "raw"); OUT = os.path.join(HERE, "_cache", "try"); os.makedirs(OUT, exist_ok=True)

def srgb_to_lin(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
def lin_to_srgb(x):
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(np.clip(x, 0, 1), 1 / 2.4) - 0.055)

PAPER = np.array([0.949, 0.910, 0.847]); INK = np.array([0.110, 0.094, 0.075])

def flatten_lowfreq(lum, scale=10, lo=0.86, hi=1.16):
    """用低分辨率模糊估计光照/泛黄色偏的慢变化场并除掉它。lum: linear float 2D"""
    h, w = lum.shape
    small = np.asarray(Image.fromarray((np.clip(lin_to_srgb(lum), 0, 1) * 255).astype(np.uint8)).resize((max(w//scale,2), max(h//scale,2)), Image.BOX), dtype=np.float32) / 255.0
    field = np.asarray(Image.fromarray(small).resize((w, h), Image.BICUBIC), dtype=np.float32)
    field = np.clip(field, lo * np.median(field), hi * np.median(field))
    ratio = field / np.median(field)
    return lum / ratio

def tonemap(im, white_pct=99.0, black_pct=0.2, contrast=1.08, flatten=True, sharp=0.35):
    arr = np.asarray(im.convert("RGB"), dtype=np.float32) / 255.0
    lin = srgb_to_lin(arr)
    lum = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
    if flatten:
        lum = flatten_lowfreq(lum)
    if sharp > 0:
        l8 = np.clip(lin_to_srgb(lum) * 255, 0, 255).astype(np.uint8)
        li = Image.fromarray(l8).filter(ImageFilter.UnsharpMask(radius=1.1, percent=int(sharp * 100), threshold=2))
        lum = srgb_to_lin(np.asarray(li, dtype=np.float32) / 255.0)
    b = np.percentile(lum, black_pct); w = np.percentile(lum, white_pct)
    t = np.clip((lum - b) / max(w - b, 1e-6), 0.0, 1.0)
    t = np.clip((t - 0.5) * contrast + 0.5, 0.0, 1.0) ** 1.02
    p = srgb_to_lin(PAPER.astype(np.float32)); k = srgb_to_lin(INK.astype(np.float32))
    out = k[None, None, :] + (p - k)[None, None, :] * t[..., None]
    # 轻暗角（最大 12%）
    h, wd = out.shape[:2]
    yy, xx = np.mgrid[0:h, 0:wd].astype(np.float32)
    r2 = ((xx - wd / 2) / (wd / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2
    vig = 1.0 - 0.12 * np.clip(r2 / 2.0, 0, 1) ** 1.4
    out = out * vig[..., None]
    return lin_to_srgb(np.clip(out, 0, 1))

def contact(items, cell_w, out_name, cols=2):
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

im = Image.open(os.path.join(RAW, "entry_full.jpg")).convert("RGB")
items = []
for x in [10514, 10914, 11314, 17814, 18614, 19414, 20214, 21014]:
    out = tonemap(im.crop((x, 0, x + 1600, 900)))
    items.append((f"x={x}", Image.fromarray((np.clip(out,0,1) * 255).astype(np.uint8))))
contact(items, 600, "entry_candidates2.jpg", cols=2)
