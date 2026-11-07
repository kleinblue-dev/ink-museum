import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_and_compose as F
OUT = os.path.join(F.HERE, "_cache", "try")
bam = Image.open(os.path.join(F.RAW, "bamboo_wentong.jpg")).convert("RGB")
w,h = bam.size
c = bam.crop((0, int(0.185*h), w, h))
tone = dict(white_pct=78, black_pct=0.3, contrast=1.10, sharpen=0.45)
arr = F.tonemap(c, **tone)
img = Image.fromarray((np.clip(arr,0,1)*255+0.5).astype(np.uint8))
print("painting area", img.size)
img.thumbnail((700, 1600), Image.LANCZOS)
img.save(os.path.join(OUT, "bamboo_painting_view.jpg"), quality=90)
print("saved", img.size)
