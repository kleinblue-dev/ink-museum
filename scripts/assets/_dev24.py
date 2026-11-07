import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_and_compose as F
OUT = os.path.join(F.HERE, "_cache", "try")

def render(im, box, size, tone, fb=0.0):
    w,h = im.size
    l,t,r,b = box
    c = im.crop((int(l*w), int(t*h), int(r*w), int(b*h)))
    arr = F.tonemap(c, **tone)
    img = Image.fromarray((np.clip(arr,0,1)*255+0.5).astype(np.uint8)).resize(size, Image.LANCZOS)
    if fb: img = img.filter(ImageFilter.GaussianBlur(fb)).filter(ImageFilter.UnsharpMask(1.0, 35, 2))
    return img

def contact(items, cell_w, name, cols):
    rows = (len(items)+cols-1)//cols
    ch = int(cell_w*items[0][1].size[1]/items[0][1].size[0])
    sheet = Image.new("RGB",(cols*cell_w, rows*(ch+22)),(25,25,25)); d=ImageDraw.Draw(sheet)
    for i,(lab,img) in enumerate(items):
        cx,cy=(i%cols)*cell_w,(i//cols)*(ch+22)
        sheet.paste(img.resize((cell_w,ch),Image.LANCZOS),(cx,cy)); d.text((cx+6,cy+ch+3),lab,fill=(245,245,245))
    sheet.save(os.path.join(OUT,name),quality=90); print("wrote",name,sheet.size)

bt = dict(white_pct=99.0, black_pct=0.3, contrast=1.10, sharpen=0.45)
bam = Image.open(os.path.join(F.RAW, "bamboo_wentong.jpg")).convert("RGB")
print("bamboo", bam.size)
items=[]
for y0 in (0.20, 0.28, 0.36):
    box=(0.0, y0, 1.0, y0+1030/2880)
    items.append((f"wide y0={y0:.2f}", render(bam, box, (640,360), bt, 0.5)))
contact(items, 480, "bamboo_wide_cand.jpg", cols=2)
titems=[]
for y0, x0 in ((0.18,0.10),(0.18,0.22),(0.26,0.10),(0.26,0.22)):
    box=(x0, y0, x0+1029/1830, y0+1646/2880)
    titems.append((f"tall x={x0:.2f} y={y0:.2f}", render(bam, box, (450,720), bt, 0.5)))
contact(titems, 300, "bamboo_tall_cand.jpg", cols=4)

pt = dict(white_pct=98.0, black_pct=0.2, contrast=1.16, sharpen=0.55)
pav = Image.open(os.path.join(F.RAW, "pavilion.jpg")).convert("RGB")
print("pavilion", pav.size)
items=[]
for y0 in (0.44, 0.48, 0.52):
    box=(0.04, y0, 0.96, y0+925/3674)
    items.append((f"wide y0={y0:.2f}", render(pav, box, (640,360), pt, 0.5)))
contact(items, 480, "pavilion_wide_cand.jpg", cols=2)
titems=[]
for y0, x0 in ((0.40,0.05),(0.40,0.15),(0.44,0.05),(0.44,0.15)):
    box=(x0, y0, x0+1028/1788, y0+1645/3674)
    titems.append((f"tall x={x0:.2f} y={y0:.2f}", render(pav, box, (450,720), pt, 0.5)))
contact(titems, 300, "pavilion_tall_cand.jpg", cols=4)
