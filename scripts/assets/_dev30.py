import os
import numpy as np
from PIL import Image
BG = r"C:\Users\samcz\Documents\deepseek-harness\default-workspace\ink-museum\assets\bg"
for f in ("entry-wide.webp","spring-wide.webp","water-wide.webp","bamboo-wide.webp","pavilion-wide.webp","bamboo-tall.webp"):
    im = Image.open(os.path.join(BG,f)).convert("RGB")
    a = np.asarray(im, np.float32)/255.0
    lum = 0.2126*a[...,0]+0.7152*a[...,1]+0.0722*a[...,2]
    print(f, "p50=%.3f p80=%.3f p95=%.3f mean=%.3f" % tuple(np.percentile(lum,[50,80,95]).tolist()+[lum.mean()]),
          "medianRGB=", (np.percentile(a.reshape(-1,3),50,axis=0)*255).round(0))
