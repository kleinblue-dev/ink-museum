import os, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _dev3 import tonemap, RAW, OUT, contact
im = Image.open(os.path.join(RAW, "entry_full.jpg")).convert("RGB")
items = []
for x in [10720, 11100, 13650, 14050, 14450, 17950, 18350, 19150]:
    out = tonemap(im.crop((x, 0, x + 544, 870)))
    img = Image.fromarray((np.clip(out,0,1)*255).astype(np.uint8)).resize((900,1440), Image.LANCZOS)
    items.append((f"x={x}", img))
contact(items, 300, "entry_tall2.jpg", cols=4)
