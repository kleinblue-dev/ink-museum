import os, sys
import numpy as np
from PIL import Image, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_and_compose import tonemap, srgb_to_lin, lin_to_srgb, RAW
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_cache", "try")

def denoise_lum(im):
    arr = np.asarray(im, np.float32)/255.0
    lin = srgb_to_lin(arr)
    lum = 0.2126*lin[...,0]+0.7152*lin[...,1]+0.0722*lin[...,2]
    l8 = np.clip(lin_to_srgb(lum)*255,0,255).astype(np.uint8)
    mi = Image.fromarray(l8).filter(ImageFilter.MedianFilter(3))
    lnew = srgb_to_lin(np.asarray(mi, np.float32)/255.0)
    lin = lin*(lnew/np.maximum(lum,1e-4))[...,None]
    return Image.fromarray((np.clip(lin_to_srgb(np.clip(lin,0,1)),0,1)*255).astype(np.uint8))

full = Image.open(os.path.join(RAW, "entry_full.jpg")).convert("RGB")
c = full.crop((15314, 0, 15858, 870))
c = denoise_lum(c)
arr = tonemap(c, white_pct=99.2, black_pct=0.4, contrast=1.06, sharpen=0.4)
img = Image.fromarray((np.clip(arr,0,1)*255+0.5).astype(np.uint8)).resize((900,1440), Image.LANCZOS)
img.save(os.path.join(OUT, "entry_tall_x15314.jpg"), quality=90)
print("saved", img.size)
# 检查该区域列梯度接缝
a = np.asarray(full.crop((15000,0,16200,870)).convert("RGB"), np.float32)/255.0
col = a.mean(axis=(0,2)); d = np.abs(np.diff(col))
k = np.ones(9)/9; ds = np.convolve(d, k, mode="same")
thr = ds.mean()+5*ds.std()
print("seams in 15000-16200:", [15000+int(i) for i in np.where(ds>thr)[0]])
