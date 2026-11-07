import os, sys, io
import numpy as np
from PIL import Image, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_and_compose import tonemap, crop_norm, RAW, srgb_to_lin, lin_to_srgb, PAPER, INK

im = Image.open(os.path.join(RAW, "entry_full.jpg")).convert("RGB")
crop = im.crop((10960, 0, 12507, 870))

def encode(img, q):
    buf = io.BytesIO(); img.save(buf, "WEBP", quality=q, method=6); return len(buf.getvalue())

def variant(name, denoise=False, blur=0.0, sharp=0.4, contrast=1.06, qtest=65):
    src = crop
    if denoise:
        # 在亮度上做中值去噪（保边），重建 RGB 亮度
        arr = np.asarray(src, np.float32)/255.0
        lin = srgb_to_lin(arr)
        lum = 0.2126*lin[...,0]+0.7152*lin[...,1]+0.0722*lin[...,2]
        l8 = np.clip(lin_to_srgb(lum)*255,0,255).astype(np.uint8)
        mi = Image.fromarray(l8).filter(ImageFilter.MedianFilter(3))
        if blur: mi = mi.filter(ImageFilter.GaussianBlur(blur))
        lnew = srgb_to_lin(np.asarray(mi, np.float32)/255.0)
        ratio = lnew/np.maximum(lum,1e-4)
        lin = lin*ratio[...,None]
        arr = lin_to_srgb(np.clip(lin,0,1))
        src = Image.fromarray((np.clip(arr,0,1)*255).astype(np.uint8))
    out = tonemap(src, contrast=contrast, sharpen=sharp)
    img = Image.fromarray((np.clip(out,0,1)*255+0.5).astype(np.uint8)).resize((1600,900), Image.LANCZOS)
    sizes = {q: encode(img, q) for q in (55, 65, 75, 85)}
    print(name, {q: f"{n/1024:.0f}KB" for q,n in sizes.items()})

variant("V1 current", False, 0, 0.4, 1.06)
variant("V2 median3", True, 0, 0.3, 1.06)
variant("V3 median3+blur.4", True, 0.4, 0.25, 1.06)
variant("V4 median3 sharp.15", True, 0, 0.15, 1.04)
