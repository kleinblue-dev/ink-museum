import os, sys
from PIL import Image, ImageFilter
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_and_compose import tonemap, srgb_to_lin, lin_to_srgb, RAW
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_cache", "try")

def denoise_lum(im):
    arr = np.asarray(im, np.float32)/255.0
    lin = srgb_to_lin(arr)
    lum = 0.2126*lin[...,0]+0.7152*lin[...,1]+0.0722*lin[...,2]
    l8 = np.clip(lin_to_srgb(lum)*255,0,255).astype(np.uint8)
    mi = Image.fromarray(l8).filter(ImageFilter.MedianFilter(3))
    lin = lin*(srgb_to_lin(np.asarray(mi, np.float32)/255.0)/np.maximum(lum,1e-4))[...,None]
    return Image.fromarray((np.clip(lin_to_srgb(np.clip(lin,0,1)),0,1)*255).astype(np.uint8))

full = Image.open(os.path.join(RAW, "entry_full.jpg")).convert("RGB")
for x0 in (10680, 14450):
    c = denoise_lum(full.crop((x0, 0, x0+544, 870)))
    arr = tonemap(c, white_pct=99.2, black_pct=0.4, contrast=1.06, sharpen=0.4)
    img = Image.fromarray((np.clip(arr,0,1)*255+0.5).astype(np.uint8)).resize((900,1440), Image.LANCZOS)
    img.save(os.path.join(OUT, f"entry_tall_x{x0}.jpg"), quality=90)
    print("saved", x0)
