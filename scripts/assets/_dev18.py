import os, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_and_compose as F
OUT = os.path.join(F.HERE, "_cache", "try")

def heal(im, seams, half=4, ramp=90):
    arr = np.asarray(im.convert("RGB"), np.float32)/255.0
    h, w = arr.shape[:2]
    for x in seams:
        if x < half+8 or x > w-half-8: continue
        l, r = x-half-6, x+half+6
        for c in range(x-half, x+half+1):
            t = (c-l)/(r-l)
            arr[:, c, :] = arr[:, l, :]*(1-t) + arr[:, r, :]*t
        ramp2 = min(ramp, x-2, w-x-2)
        left = arr[:, x-ramp2:x-6, :].mean(axis=(0,1))
        right = arr[:, x+7:x+ramp2, :].mean(axis=(0,1))
        d = (right - left).mean()
        for i in range(ramp2):
            t = i/ramp2
            arr[:, x-ramp2+i, :] += d*0.5*t
            arr[:, x+ramp2-i-1, :] += d*0.5*t
    return Image.fromarray((np.clip(arr,0,1)*255+0.5).astype(np.uint8))

src = Image.open(os.path.join(F.RAW, "water_wave.jpg")).convert("RGB")
healed = heal(src, [513, 872, 1219])
tone = dict(white_pct=99.0, black_pct=0.3, contrast=1.12, sharpen=0.55)
def render(im, box, size, tone, fb=0.0):
    c = im.crop(box)
    arr = F.tonemap(c, **tone)
    img = Image.fromarray((np.clip(arr,0,1)*255+0.5).astype(np.uint8)).resize(size, Image.LANCZOS)
    if fb:
        img = img.filter(ImageFilter.GaussianBlur(fb)).filter(ImageFilter.UnsharpMask(1.0, 35, 2))
    return img
from PIL import ImageFilter
w = render(healed, (260,200,1708,1015), (1600,900), tone, 0.5)
w.save(os.path.join(OUT, "water_wide_healed.jpg"), quality=90)
t = render(healed, (350,0,1047,1115), (900,1440), tone, 0.4)
t.save(os.path.join(OUT, "water_tall_healed.jpg"), quality=90)
print("ok")
