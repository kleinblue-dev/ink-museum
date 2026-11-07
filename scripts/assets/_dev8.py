import os, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _dev3 import tonemap, RAW, OUT
im2 = Image.open(os.path.join(RAW, "entry_alt_2000.png")).convert("RGB")
def save(name, img):
    img.save(os.path.join(OUT, name), quality=88); print("wrote", name, img.size)
for label, box in [("tall_altA", (200, 28, 1140, 1527)), ("tall_altB", (60, 28, 1000, 1527))]:
    c = im2.crop(box)
    out = tonemap(c)
    save(label + ".jpg", Image.fromarray((np.clip(out,0,1)*255).astype(np.uint8)).resize((900,1440), Image.LANCZOS))
# 剩山图整体（去掉色卡/题跋）看看可用区域
c = im2.crop((14, 28, 1949, 1595)); out = tonemap(c, flatten=False)
save("alt_paint_only.jpg", Image.fromarray((np.clip(out,0,1)*255).astype(np.uint8)).resize((900,729), Image.LANCZOS))
