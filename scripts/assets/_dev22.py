import os, sys
import numpy as np
from PIL import Image, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_and_compose as F
OUT = os.path.join(F.HERE, "_cache", "try")

def heal3(im, seams, shift=42, half=14):
    arr = np.asarray(im.convert("RGB"), np.float32)/255.0
    h, w = arr.shape[:2]
    for x in seams:
        if x-half-12<0 or x+half+12>=w: continue
        src = arr[:, x-shift-half:x-shift+half, :].copy()
        t = np.linspace(0,1,2*half)[None,:,None]
        feather = np.clip(np.minimum(t,1-t)/0.45,0,1)
        arr[:, x-half:x+half, :] = arr[:, x-half:x+half, :]*(1-feather) + src*feather
    return Image.fromarray((np.clip(arr,0,1)*255+0.5).astype(np.uint8))

tone = dict(white_pct=99.0, black_pct=0.3, contrast=1.12, sharpen=0.55)
def render(im, box, size, fb):
    c = im.crop(box)
    arr = F.tonemap(c, **tone)
    img = Image.fromarray((np.clip(arr,0,1)*255+0.5).astype(np.uint8)).resize(size, Image.LANCZOS)
    return img.filter(ImageFilter.GaussianBlur(fb)).filter(ImageFilter.UnsharpMask(1.0, 35, 2))
w = Image.open(os.path.join(F.RAW, "water_wave.jpg")).convert("RGB")
hw = heal3(w, [513, 872, 1219])
render(hw, (260,200,1708,1015), (1600,900), 0.5).save(os.path.join(OUT,"water_wide_heal3.jpg"), quality=90)
render(hw, (350,0,1047,1115), (900,1440), 0.4).save(os.path.join(OUT,"water_tall_heal3.jpg"), quality=90)
print("ok")
