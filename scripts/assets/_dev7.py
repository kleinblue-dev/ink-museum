import os, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _dev3 import tonemap, RAW, OUT

def save(name, img):
    img.save(os.path.join(OUT, name), quality=88); print("wrote", name, img.size)

im = Image.open(os.path.join(RAW, "entry_full.jpg")).convert("RGB")
for x in [11560, 11880, 12200, 18150]:
    out = tonemap(im.crop((x, 0, x + 544, 870)))
    save(f"tall_fs_{x}.jpg", Image.fromarray((np.clip(out,0,1)*255).astype(np.uint8)).resize((900,1440), Image.LANCZOS))

im2 = Image.open(os.path.join(RAW, "entry_alt_2000.png")).convert("RGB")
save("alt_full_view.jpg", im2.crop((0,0,2260,1960)).resize((800,694), Image.LANCZOS))
# 剩山图：去掉色卡/题跋后竖裁，避开上部藏印
c = im2.crop((300, 440, 2100, 1875))   # 1800x1435
out = tonemap(c)
save("tall_alt_belowseals.jpg", Image.fromarray((np.clip(out,0,1)*255).astype(np.uint8)).resize((900,717), Image.LANCZOS))
