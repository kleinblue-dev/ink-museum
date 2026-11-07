import os, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_and_compose import RAW
for f in ("water_wave.jpg", "water_rip.jpg"):
    im = Image.open(os.path.join(RAW, f)).convert("RGB")
    a = np.asarray(im, np.float32)/255.0
    lum = 0.2126*a[...,0]+0.7152*a[...,1]+0.0722*a[...,2]
    col = lum.mean(axis=0)
    # 局部中值
    k = 41
    pad = np.pad(col, (k//2, k//2), mode="edge")
    med = np.array([np.median(pad[i:i+k]) for i in range(len(col))])
    dev = col - med
    # 找明显偏暗的列（接缝暗线）
    idx = np.where(dev < -0.012)[0]
    groups=[]
    for i in idx:
        if groups and i-groups[-1][-1]<=3: groups[-1].append(i)
        else: groups.append([i])
    print(f, im.size, "dark-line cols:", [(g[0],g[-1]) for g in groups][:20])
    print("  dev min/max:", dev.min(), dev.max())
