import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_and_compose as F
OUT = os.path.join(F.HERE, "_cache", "try")

def render(im, box, size, tone, fb=0.0):
    w,h = im.size; l,t,r,b = box
    c = im.crop((int(l*w), int(t*h), int(r*w), int(b*h)))
    arr = F.tonemap(c, **tone)
    img = Image.fromarray((np.clip(arr,0,1)*255+0.5).astype(np.uint8)).resize(size, Image.LANCZOS)
    if fb: img = img.filter(ImageFilter.GaussianBlur(fb)).filter(ImageFilter.UnsharpMask(1.0, 35, 2))
    return img

bam = Image.open(os.path.join(F.RAW, "bamboo_wentong.jpg")).convert("RGB")
items=[]
for wp in (70, 80, 88, 94):
    tone = dict(white_pct=wp, black_pct=0.3, contrast=1.10, sharpen=0.45)
    img = render(bam, (0.02, 0.17, 0.98, 0.99), (560, 470), tone, 0.4)
    items.append((f"white_pct={wp}", img))
sheet = Image.new("RGB",(4*420, 500),(25,25,25)); d=ImageDraw.Draw(sheet)
for i,(lab,img) in enumerate(items):
    im2 = img.copy(); im2.thumbnail((420,470), Image.LANCZOS)
    sheet.paste(im2, (i*420, 0)); d.text((i*420+6, 478), lab, fill=(245,245,245))
sheet.save(os.path.join(OUT,"bamboo_tone_test.jpg"), quality=90)
print("wrote", sheet.size)
