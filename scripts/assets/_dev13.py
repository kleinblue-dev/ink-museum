import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_and_compose import tonemap, srgb_to_lin, lin_to_srgb, RAW
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_cache", "try")

def denoise_lum(im, blur=0.0):
    arr = np.asarray(im, np.float32)/255.0
    lin = srgb_to_lin(arr)
    lum = 0.2126*lin[...,0]+0.7152*lin[...,1]+0.0722*lin[...,2]
    l8 = np.clip(lin_to_srgb(lum)*255,0,255).astype(np.uint8)
    mi = Image.fromarray(l8).filter(ImageFilter.MedianFilter(3))
    if blur: mi = mi.filter(ImageFilter.GaussianBlur(blur))
    lnew = srgb_to_lin(np.asarray(mi, np.float32)/255.0)
    lin = lin*(lnew/np.maximum(lum,1e-4))[...,None]
    return Image.fromarray((np.clip(lin_to_srgb(np.clip(lin,0,1)),0,1)*255).astype(np.uint8))

def render(im, box, size, tone, denoise=True):
    c = im.crop(box)
    if denoise: c = denoise_lum(c)
    arr = tonemap(c, **tone)
    return Image.fromarray((np.clip(arr,0,1)*255+0.5).astype(np.uint8)).resize(size, Image.LANCZOS)

def contact(items, cell_w, name, cols):
    rows = (len(items)+cols-1)//cols
    ch = int(cell_w*items[0][1].size[1]/items[0][1].size[0])
    sheet = Image.new("RGB",(cols*cell_w, rows*(ch+30)),(25,25,25)); d=ImageDraw.Draw(sheet)
    for i,(lab,img) in enumerate(items):
        cx,cy=(i%cols)*cell_w,(i//cols)*(ch+30)
        sheet.paste(img.resize((cell_w,ch),Image.LANCZOS),(cx,cy)); d.text((cx+6,cy+ch+3),lab,fill=(245,245,245))
    sheet.save(os.path.join(OUT,name),quality=90); print("wrote",name,sheet.size)

tone = dict(white_pct=99.2, black_pct=0.4, contrast=1.06, sharpen=0.4)
full = Image.open(os.path.join(RAW, "entry_full.jpg")).convert("RGB")
items=[]
for x0 in [11360, 11430]:
    img = render(full, (x0,0,x0+1547,870), (1600,900), tone)
    items.append((f"wide x0={x0}", img))
contact(items, 800, "entry_wide_fix.jpg", cols=1)
imgs=[]
for x0 in [15314, 15700, 16100]:
    img = render(full, (x0,0,x0+544,870), (900,1440), tone)
    imgs.append((f"tall x={x0}", img))
alt = Image.open(os.path.join(RAW, "entry_tall.png")).convert("RGB")
img = render(alt, (60,28,1000,1527), (900,1440), tone)
imgs.append(("altB", img))
contact(imgs, 270, "entry_tall_fix.jpg", cols=4)
