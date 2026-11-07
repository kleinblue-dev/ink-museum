import os, sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _dev import tonemap, RAW, OUT, contact
im = Image.open(os.path.join(RAW, "entry_full.jpg")).convert("RGB")
items = []
for x in [10514, 15314, 18514, 20114]:
    crop = im.crop((x, 0, x + 1600, 900))
    for contrast, bp in [(1.0, 0.5), (1.08, 0.2)]:
        out = tonemap(crop, white_pct=99.0, black_pct=bp, contrast=contrast)
        items.append((f"x={x} c={contrast} bp={bp}", Image.fromarray((out*255).astype(np.uint8))))
contact(items, 480, "entry_tones.jpg", cols=2)
