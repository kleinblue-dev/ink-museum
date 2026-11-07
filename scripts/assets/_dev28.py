import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_and_compose as F
OUT = os.path.join(F.HERE, "_cache", "try")
bam = Image.open(os.path.join(F.RAW, "bamboo_wentong.jpg")).convert("RGB")
w,h = bam.size
box=(0.0,0.205,1.0,0.5623)
c = bam.crop((0,int(0.205*h),w,int(0.5623*h)))
items=[]
for wp, ct in ((68,1.05),(72,1.06),(78,1.10),(62,1.02)):
    tone=dict(white_pct=wp, black_pct=0.3, contrast=ct, sharpen=0.45)
    arr=F.tonemap(c, **tone)
    img=Image.fromarray((np.clip(arr,0,1)*255+0.5).astype(np.uint8)).resize((640,360),Image.LANCZOS)
    img=img.filter(ImageFilter.GaussianBlur(0.5)).filter(ImageFilter.UnsharpMask(1.0,35,2))
    items.append((f"wp={wp} c={ct}", img))
sheet=Image.new("RGB",(2*640,2*382),(25,25,25)); d=ImageDraw.Draw(sheet)
for i,(lab,img) in enumerate(items):
    cx,cy=(i%2)*640,(i//2)*382
    sheet.paste(img,(cx,cy)); d.text((cx+6,cy+363),lab,fill=(245,245,245))
sheet.save(os.path.join(OUT,"bamboo_tone2.jpg"),quality=90); print("ok")
