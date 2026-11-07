import os, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _dev3 import tonemap, RAW, OUT, contact
im = Image.open(os.path.join(RAW, "spring.jpg")).convert("RGB")
print("spring", im.size)
items = []
# 宽幅候选：全宽 16:9 条带
for y in [300, 700, 1100, 1500, 1900, 2300]:
    c = im.crop((100, y, 2300, y + 1238))
    out = tonemap(c)
    items.append((f"wide y={y}", Image.fromarray((np.clip(out,0,1)*255).astype(np.uint8))))
contact(items, 480, "spring_wide_candidates.jpg", cols=2)
# 竖幅候选
titems = []
for label, box in [("T1", (280, 340, 2159, 3345)), ("T2", (100, 340, 1979, 3345)), ("T3", (280, 500, 2159, 3506))]:
    c = im.crop(box)
    out = tonemap(c)
    titems.append((label + f" {c.size}", Image.fromarray((np.clip(out,0,1)*255).astype(np.uint8)).resize((900,1440), Image.LANCZOS)))
contact(titems, 360, "spring_tall_candidates.jpg", cols=3)
