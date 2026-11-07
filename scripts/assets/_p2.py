import os
from PIL import Image
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_cache")
RAW = os.path.join(CACHE, "raw"); OUT = os.path.join(CACHE, "preview")
im = Image.open(os.path.join(RAW, "entry_alt_thumb.png")).convert("RGB")
im.thumbnail((900, 4000), Image.LANCZOS); im.save(os.path.join(OUT, "entry_alt2.jpg"), quality=90)
print(im.size)
print(sorted(os.listdir(RAW)))
