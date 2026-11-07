import os, sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_and_compose as F
OUT = os.path.join(F.HERE, "_cache", "try")

# 直接调用内部函数做不同 strength 的试验
items=[]
for st, blur, cnt in ((0.45,1.4,900),(0.6,1.3,900),(0.75,1.5,1200)):
    arr = F.paper_base(1600,900,seed=20260)
    img = Image.fromarray((arr*255+0.5).astype(np.uint8))
    img = F.draw_fibers(img, seed=717, count=cnt, strength=st)
    # 用更强模糊再试
    img = img.filter(ImageFilter.GaussianBlur(0.2)) if False else img
    img = F.add_vignette(img, 0.07)
    # 取 1:1 局部看纹理
    crop = img.crop((500,250,900,650))
    items.append((f"strength={st} blur?={blur}", crop))
sheet = Image.new("RGB",(3*420, 440),(25,25,25)); d=ImageDraw.Draw(sheet)
for i,(lab,img) in enumerate(items):
    sheet.paste(img, (i*420, 0)); d.text((i*420+6, 415), lab, fill=(245,245,245))
sheet.save(os.path.join(OUT,"scroll_fiber_test.jpg"), quality=92); print("ok")
