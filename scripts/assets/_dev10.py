import os, sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _dev3 import tonemap, RAW, OUT, contact

def save(name, img):
    img.save(os.path.join(OUT, name), quality=88); print("wrote", name, img.size)

# --- spring 全图概览 + 网格 ---
im = Image.open(os.path.join(RAW, "spring.jpg")).convert("RGB")
W, H = im.size
print("spring", W, H)
ov = im.copy()
d = ImageDraw.Draw(ov)
for fx in range(1, 10):
    d.line([(W*fx/10, 0), (W*fx/10, H)], fill=(255, 0, 0), width=8)
    d.text((W*fx/10+12, 20), f"x={fx/10:.1f}", fill=(255,0,0))
for fy in range(1, 10):
    d.line([(0, H*fy/10), (W, H*fy/10)], fill=(0, 120, 255), width=8)
    d.text((12, H*fy/10+10), f"y={fy/10:.1f}", fill=(0,80,255))
save("spring_grid.jpg", ov.resize((760, 1110), Image.LANCZOS))

# --- spring 宽幅候选（x 180..3620）---
items = []
for y in [300, 700, 1100, 1500, 1900]:
    c = im.crop((180, y, 3620, y + 1935))
    out = tonemap(c)
    items.append((f"wide y={y}", Image.fromarray((np.clip(out,0,1)*255).astype(np.uint8))))
contact(items, 480, "spring_wide2.jpg", cols=2)

# --- spring 竖幅候选 ---
titems = []
for label, box in [("T1 y300", (220, 300, 3538, 5609)), ("T2 y800", (300, 800, 3465, 5865) if False else (220, 800, 3300, 5609)), ("T3 x280..3340", (280, 300, 3340, 5196))]:
    c = im.crop(box)
    ratio = c.size[0] / c.size[1]
    out = tonemap(c)
    titems.append((f"{label} {c.size} r={ratio:.2f}", Image.fromarray((np.clip(out,0,1)*255).astype(np.uint8)).resize((900,1440), Image.LANCZOS)))
contact(titems, 360, "spring_tall2.jpg", cols=3)

# --- entry 竖幅锐化测试 ---
im2 = Image.open(os.path.join(RAW, "entry_alt_2000.png")).convert("RGB")
c = im2.crop((200, 28, 1140, 1527))
outs = []
for label, kw in [("sharp60", dict(sharp=0.6)), ("sharp90-flat6", dict(sharp=0.9, flatten_scale=6))]:
    out = tonemap(c, **kw)
    outs.append((label, Image.fromarray((np.clip(out,0,1)*255).astype(np.uint8)).resize((900,1440), Image.LANCZOS)))
contact(outs, 360, "entry_tall_sharp.jpg", cols=2)
