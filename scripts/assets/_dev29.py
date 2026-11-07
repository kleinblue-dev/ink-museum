import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_and_compose as F
OUT = os.path.join(F.HERE, "_cache", "try")
bam = Image.open(os.path.join(F.RAW, "bamboo_wentong.jpg")).convert("RGB")
w,h = bam.size
c = bam.crop((0,int(0.205*h),w,int(0.5623*h)))
items=[]
for label, lo, hi, sc, wp in (("A .75/1.30 s8", 0.75, 1.30, 8, 80), ("B .70/1.40 s6", 0.70, 1.40, 6, 82), ("C .80/1.25 s12", 0.80, 1.25, 12, 80), ("D .65/1.50 s5", 0.65, 1.50, 5, 84)):
    # 手动做 flatten 再映射
    arr = np.asarray(c.convert("RGB"), np.float32)/255.0
    lin = F.srgb_to_lin(arr)
    lum = 0.2126*lin[...,0]+0.7152*lin[...,1]+0.0722*lin[...,2]
    fl = F.flatten_lowfreq(lum, scale=sc, lo=lo, hi=hi)
    # 用近似 tonemap 重算：把 lum 替换
    l8 = np.clip(F.lin_to_srgb(fl)*255,0,255).astype(np.uint8)
    mi = Image.fromarray(l8).filter(ImageFilter.MedianFilter(3))
    lnew = F.srgb_to_lin(np.asarray(mi, np.float32)/255.0)
    b = np.percentile(lnew, 0.3); wpt = np.percentile(lnew, wp)
    t = np.clip((lnew-b)/max(wpt-b,1e-6),0,1)
    t = np.clip((t-0.5)*1.06+0.5,0,1)**1.02
    p = F.srgb_to_lin(F.PAPER); k = F.srgb_to_lin(F.INK)
    out = k[None,None,:]+(p-k)[None,None,:]*t[...,None]
    img = Image.fromarray((np.clip(F.lin_to_srgb(np.clip(out,0,1)),0,1)*255).astype(np.uint8)).resize((640,360), Image.LANCZOS)
    img = img.filter(ImageFilter.GaussianBlur(0.5)).filter(ImageFilter.UnsharpMask(1.0,35,2))
    items.append((label, img))
sheet=Image.new("RGB",(2*640,2*382),(25,25,25)); d=ImageDraw.Draw(sheet)
for i,(lab,img) in enumerate(items):
    cx,cy=(i%2)*640,(i//2)*382
    sheet.paste(img,(cx,cy)); d.text((cx+6,cy+363),lab,fill=(245,245,245))
sheet.save(os.path.join(OUT,"bamboo_tone3.jpg"),quality=90); print("ok")
