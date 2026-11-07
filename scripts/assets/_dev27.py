import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_and_compose as F
OUT = os.path.join(F.HERE, "_cache", "try")

def contact(items, cell_w, name, cols):
    rows = (len(items)+cols-1)//cols
    ch = int(cell_w*items[0][1].size[1]/items[0][1].size[0])
    sheet = Image.new("RGB",(cols*cell_w, rows*(ch+22)),(25,25,25)); d=ImageDraw.Draw(sheet)
    for i,(lab,img) in enumerate(items):
        cx,cy=(i%cols)*cell_w,(i//cols)*(ch+22)
        sheet.paste(img.resize((cell_w,ch),Image.LANCZOS),(cx,cy)); d.text((cx+6,cy+ch+3),lab,fill=(245,245,245))
    sheet.save(os.path.join(OUT,name),quality=90); print("wrote",name,sheet.size)

bam = Image.open(os.path.join(F.RAW, "bamboo_wentong.jpg")).convert("RGB")
tone = dict(white_pct=78, black_pct=0.3, contrast=1.10, sharpen=0.45)
def render(box, size, fb=0.5):
    w,h=bam.size; l,t,r,b=box
    c=bam.crop((int(l*w),int(t*h),int(r*w),int(b*h)))
    arr=F.tonemap(c,**tone)
    img=Image.fromarray((np.clip(arr,0,1)*255+0.5).astype(np.uint8)).resize(size,Image.LANCZOS)
    return img.filter(ImageFilter.GaussianBlur(fb)).filter(ImageFilter.UnsharpMask(1.0,35,2))

# 宽幅候选（y0,y1 组合 / x 裁法）
cands=[
 ("W1 full y.205-.562", (0.0,0.205,1.0,0.205+1029/2880)),
 ("W2 full y.30-.657", (0.0,0.30,1.0,0.30+1029/2880)),
 ("W3 full y.42-.777", (0.0,0.42,1.0,0.42+1029/2880)),
 ("W4 x.18-1 y.10-.56", (0.18,0.10,0.18+1500/1830,0.10+843/2880)),
 ("W5 x0-.82 y.35-.81", (0.0,0.35,1500/1830,0.35+843/2880)),
 ("W6 full y.55-.907", (0.0,0.55,1.0,0.55+1029/2880)),
]
items=[(lab, render(box,(640,360))) for lab,box in cands]
contact(items, 480, "bamboo_wide2.jpg", cols=2)

# 竖幅候选
tc=[
 ("T1 y.20-.985 x.10", (0.10,0.20,0.10+1413/1830,0.985)),
 ("T2 y.20-.985 x.00", (0.00,0.20,1413/1830,0.985)),
 ("T3 y.28-.96 x.18", (0.18,0.28,0.18+1170/1830,0.96)),
 ("T4 y.32-.99 center", (0.114,0.32,0.114+1170/1830,0.99)),
]
titems=[(lab, render(box,(450,720),0.4)) for lab,box in tc]
contact(titems, 300, "bamboo_tall2.jpg", cols=4)
