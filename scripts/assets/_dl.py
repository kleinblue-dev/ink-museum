# -*- coding: utf-8 -*-
"""下载候选源图到 _cache（带重试、跳过已存在）。"""
import json, os, sys, time, urllib.parse, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
UA = {"User-Agent": "ink-museum-curator/1.0 (local build; contact: none)"}
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_cache")
RAW = os.path.join(CACHE, "raw")
os.makedirs(RAW, exist_ok=True)
with open(os.path.join(CACHE, "_candidates.json"), encoding="utf-8") as f:
    C = json.load(f)

def fname(title):
    return title[len("File:"):]

def get(title, out, width=None):
    path = os.path.join(RAW, out)
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        print(f"  skip {out} ({os.path.getsize(path)/1024:.0f}KB)"); return path
    url = "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(fname(title), safe="")
    if width:
        url += f"?width={width}"
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=180) as r:
                data = r.read()
            if len(data) < 1000:
                raise RuntimeError("too small")
            with open(path, "wb") as f:
                f.write(data)
            print(f"  ok {out} {len(data)/1024:.0f}KB")
            return path
        except Exception as e:
            print(f"  retry {i} {out}: {e}"); time.sleep(5 * (i + 1))
    raise SystemExit("download failed: " + out)

JOBS = [
 ("File:富春山居圖(無用師卷).jpg", "entry_full.jpg", None),
 ("File:元黃公望富春山居圖 卷.png", "entry_alt_thumb.png", 1000),
 ("File:Huang Gongwang. Dwelling in the Fuchun Mountains. detail. National Palace Museum, Taipei.jpg", "entry_detail.jpg", 1600),
 ("File:Guo Xi - Early Spring, upscaled.jpg", "spring.jpg", 2400),
 ("File:Ma Yuan - Water Album - Ten Thousand Riplets on the Yangzi.jpg", "water_rip.jpg", None),
 ("File:Ma Yuan - Water Album - The Waving Surface of the Autumn Flood.jpg", "water_wave.jpg", None),
 ("File:Ma Yuan - Water Album - The Yellow River Breaches its Course.jpg", "water_yellow.jpg", None),
 ("File:Ma Yuan - Water Album - Clouds Rising from the Green Sea.jpg", "water_clouds.jpg", None),
 ("File:Wen Tong Babmbuk.jpg", "bamboo_wentong.jpg", 1600),
 ("File:元 柯九思 臨文同墨竹圖 軸-Bamboo after Wen Tong MET DT2770.jpg", "bamboo_kejiusi.jpg", 1600),
 ("File:宋文同墨竹 軸.jpg", "bamboo_song.jpg", None),
 ("File:Ni Zan. The Rongxi Studio.1372. 74,7x35,3. National Palace Museum, Taipei.jpg", "pavilion.jpg", 1600),
]
for title, out, w in JOBS:
    get(title, out, w)
    time.sleep(1.0)
print("DONE")
