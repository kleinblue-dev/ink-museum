import os, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _dev3 import tonemap, RAW, OUT, contact
im = Image.open(os.path.join(RAW, "spring.jpg")).convert("RGB")
W, H = im.size
print(W, H)
items = []
x0, x1 = int(0.06*W), int(0.93*W)
cw = x1 - x0; ch = int(cw*9/16)
for y0 in [int(0.085*H), int(0.30*H), int(0.45*H), int(0.55*H)]:
    if y0 + ch > H: y0 = H - ch
    c = im.crop((x0, y0, x1, y0+ch))
    out = tonemap(c)
    items.append((f"wide y={y0}/{y0/H:.2f}", Image.fromarray((np.clip(out,0,1)*255).astype(np.uint8))))
contact(items, 480, "spring_wide3.jpg", cols=2)

titems = []
y0, y1 = int(0.09*H), int(0.99*H)
tw = int((y1-y0)*0.625)
for label, tx in [("T full", int(0.06*W)), ("T x=.08", int(0.08*W)), ("T x=.10", int(0.10*W))]:
    c = im.crop((tx, y0, tx+tw, y1))
    out = tonemap(c)
    titems.append((f"{label} {c.size}", Image.fromarray((np.clip(out,0,1)*255).astype(np.uint8)).resize((900,1440), Image.LANCZOS)))
contact(titems, 360, "spring_tall3.jpg", cols=3)
