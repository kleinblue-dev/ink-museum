import os, sys
import numpy as np
from PIL import Image, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_and_compose as F
OUT = os.path.join(F.HERE, "_cache", "try")

def smooth1d(x, sigma):
    k = int(sigma*4)|1
    g = np.exp(-0.5*((np.arange(k)-k//2)/sigma)**2); g/=g.sum()
    pad = np.pad(x,(k//2,k//2),mode="edge")
    return np.convolve(pad, g, mode="valid")[:len(x)]

def heal2(im, seams, shift=48, half=10):
    arr = np.asarray(im.convert("RGB"), np.float32)/255.0
    h, w = arr.shape[:2]
    lum = 0.2126*arr[...,0]+0.7152*arr[...,1]+0.0722*arr[...,2]
    colmean = lum.mean(axis=0); smooth = smooth1d(colmean, 90)
    arr = arr * np.clip(smooth/np.maximum(colmean,1e-4), 0.92, 1.08)[None,:,None]
    for x in seams:
        if x-half-10<0 or x+half+10>=w: continue
        src = arr[:, x-shift-half:x-shift+half, :].copy()
        t = np.linspace(0,1,2*half)[None,:,None]
        feather = np.clip(np.minimum(t,1-t)/0.35,0,1)
        arr[:, x-half:x+half, :] = arr[:, x-half:x+half, :]*(1-feather) + src*feather
    return Image.fromarray((np.clip(arr,0,1)*255+0.5).astype(np.uint8))

tone = dict(white_pct=99.0, black_pct=0.3, contrast=1.12, sharpen=0.55)
def render(im, box, size, fb):
    c = im.crop(box)
    arr = F.tonemap(c, **tone)
    img = Image.fromarray((np.clip(arr,0,1)*255+0.5).astype(np.uint8)).resize(size, Image.LANCZOS)
    return img.filter(ImageFilter.GaussianBlur(fb)).filter(ImageFilter.UnsharpMask(1.0, 35, 2))

r = Image.open(os.path.join(F.RAW, "water_rip.jpg")).convert("RGB")
print("rip", r.size)
hr = heal2(r, [785, 1199, 1576])
render(hr, (470,180,1708,876), (1600,900), 0.5).save(os.path.join(OUT,"rip_wide.jpg"), quality=90)
render(hr, (700,0,1397,1094), (900,1440), 0.4).save(os.path.join(OUT,"rip_tall.jpg"), quality=90)
print("ok")
