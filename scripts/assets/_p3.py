import os
from PIL import Image
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_cache")
RAW = os.path.join(CACHE, "raw"); OUT = os.path.join(CACHE, "preview")
for f, w in [("bamboo_kejiusi.jpg", 650), ("bamboo_song.jpg", 650), ("pavilion.jpg", 650)]:
    im = Image.open(os.path.join(RAW, f)).convert("RGB")
    im.thumbnail((w, 4000), Image.LANCZOS)
    im.save(os.path.join(OUT, f.rsplit(".",1)[0] + ".jpg"), quality=90)
    print(f, im.size)
