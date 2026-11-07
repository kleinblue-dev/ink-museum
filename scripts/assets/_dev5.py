# -*- coding: utf-8 -*-
"""entry tall 候选：a) 无用师卷峰段放大 1.65x；b) 剩山图照片竖裁。"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _dev3 import tonemap, RAW, OUT, contact

# a) 无用师卷
im = Image.open(os.path.join(RAW, "entry_full.jpg")).convert("RGB")
a = im.crop((11320, 0, 11864, 870))  # 544x870
for w, b in [(544, 870)]:
    out = tonemap(a)
    items = [("fullscroll up1.65", Image.fromarray((np.clip(out,0,1)*255).astype(np.uint8)).resize((900,1440), Image.LANCZOS))]

# b) 剩山图照片
im2 = Image.open(os.path.join(RAW, "entry_alt_2000.png")).convert("RGB")
print("alt", im2.size)
for label, box in [("alt A", (400, 25, 2050, 1875)), ("alt B", (180, 25, 1830, 1875))]:
    c = im2.crop(box)
    # 竖裁 0.625: 取宽 = h*0.625
    h = c.size[1]; ww = int(h * 0.625)
    c2 = c.crop((max(0, (c.size[0]-ww)//2), 0, max(0,(c.size[0]-ww)//2)+ww, h))
    out = tonemap(c2)
    items.append((label, Image.fromarray((np.clip(out,0,1)*255).astype(np.uint8)).resize((900,1440), Image.LANCZOS)))
contact(items, 360, "entry_tall_candidates.jpg", cols=3)
