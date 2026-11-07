import os, sys
import numpy as np
from PIL import Image, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_and_compose as F
OUT = os.path.join(F.HERE, "_cache", "try"); os.makedirs(OUT, exist_ok=True)
for f in ("bamboo_wentong.jpg", "bamboo_kejiusi.jpg", "pavilion.jpg"):
    with Image.open(os.path.join(F.RAW, f)) as im:
        print(f, im.size)
