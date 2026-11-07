import os, sys, io
import numpy as np
from PIL import Image, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_and_compose as F

def enc(img, q):
    b = io.BytesIO(); img.save(b, "WEBP", quality=q, method=6); return len(b.getvalue())

def preblur_lum(im, r):
    arr = np.asarray(im, np.float32)/255.0
    lin = F.srgb_to_lin(arr)
    lum = 0.2126*lin[...,0]+0.7152*lin[...,1]+0.0722*lin[...,2]
    l8 = np.clip(F.lin_to_srgb(lum)*255,0,255).astype(np.uint8)
    lb = Image.fromarray(l8).filter(ImageFilter.GaussianBlur(r))
    lnew = F.srgb_to_lin(np.asarray(lb, np.float32)/255.0)
    lin = lin*(lnew/np.maximum(lum,1e-4))[...,None]
    return Image.fromarray((np.clip(F.lin_to_srgb(np.clip(lin,0,1)),0,1)*255).astype(np.uint8))

def render(src, box, size, tone, r):
    c = src.crop(box)
    if r: c = preblur_lum(c, r)
    arr = F.tonemap(c, **tone)
    return Image.fromarray((np.clip(arr,0,1)*255+0.5).astype(np.uint8)).resize(size, Image.LANCZOS)

spring = Image.open(os.path.join(F.RAW, "spring.jpg")).convert("RGB")
W,H = spring.size
box = (int(0.090104*W), int(0.095027*H), int(0.900000*W), int(0.985000*H))
tone = dict(white_pct=99.0, black_pct=0.3, contrast=1.10, sharpen=0.45)
for r in (0.0, 0.4, 0.7):
    img = render(spring, box, (900,1440), tone, r)
    print("spring tall blur", r, {q: f"{enc(img,q)/1024:.0f}KB" for q in (55,60,65,70)})

water = Image.open(os.path.join(F.RAW, "water_wave.jpg")).convert("RGB")
W2,H2 = water.size
box2 = (int(0.152225*W2), int(0.179372*H2), W2, int(0.910314*H2))
tone2 = dict(white_pct=99.0, black_pct=0.3, contrast=1.12, sharpen=0.55)
for r in (0.0, 0.35, 0.6):
    img = render(water, box2, (1600,900), tone2, r)
    print("water wide blur", r, {q: f"{enc(img,q)/1024:.0f}KB" for q in (65,70,75)})

entry = Image.open(os.path.join(F.RAW, "entry_full.jpg")).convert("RGB")
box3 = (11360,0,12907,870)
tone3 = dict(white_pct=99.2, black_pct=0.4, contrast=1.06, sharpen=0.4)
img = render(entry, box3, (1600,900), tone3, 0.0)
print("entry wide", {q: f"{enc(img,q)/1024:.0f}KB" for q in (65,70,74)})
