# -*- coding: utf-8 -*-
"""批量取候选文件的 imageinfo（尺寸/许可/直链），写入 _cache/_candidates.json。"""
import json, re, sys, time, urllib.parse, urllib.request, os
from html import unescape
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "ink-museum-curator/1.0 (local build; contact: none)"}

TITLES = [
 "File:富春山居圖(無用師卷).jpg",
 "File:元黃公望富春山居圖 卷.png",
 "File:Huang Gongwang. Dwelling in the Fuchun Mountains. detail. National Palace Museum, Taipei.jpg",
 "File:Dwelling in the Fuchun Mountains (first half).JPG",
 "File:Guo Xi - Early Spring, upscaled.jpg",
 "File:早春图轴.北宋.郭熙绘.绢本浅设色.宋神宗熙宁五年.台北故宫博物院藏.tif",
 "File:Ma Yuan - Water Album - Ten Thousand Riplets on the Yangzi.jpg",
 "File:Ma Yuan - Water Album - The Waving Surface of the Autumn Flood.jpg",
 "File:Ma Yuan - Water Album - The Yellow River Breaches its Course.jpg",
 "File:Ma Yuan - Water Album - Clouds Rising from the Green Sea.jpg",
 "File:宋文同墨竹 軸.jpg",
 "File:Wen Tong Babmbuk.jpg",
 "File:元 柯九思 臨文同墨竹圖 軸-Bamboo after Wen Tong MET DT2770.jpg",
 "File:Ke Jiusi - Bamboo after Wen Tong - 2006.571 - Metropolitan Museum of Art.jpg",
 "File:Ni Zan. The Rongxi Studio.1372. 74,7x35,3. National Palace Museum, Taipei.jpg",
]

def strip(html):
    return unescape(re.sub(r"<[^>]+>", "", html or "")).strip()

def api(params, tries=6):
    params = dict(params, format="json")
    url = API + "?" + urllib.parse.urlencode(params)
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:
            print("  retry", i, e, file=sys.stderr); time.sleep(6 * (i + 1))
    return {}

out = {}
for i in range(0, len(TITLES), 8):
    chunk = TITLES[i:i+8]
    data = api({"action": "query", "titles": "|".join(chunk),
                "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata"})
    for p in data.get("query", {}).get("pages", {}).values():
        ii = p.get("imageinfo", [{}])[0]
        if not ii:
            print("MISSING", p.get("title")); continue
        em = ii.get("extmetadata", {})
        rec = {
            "title": p.get("title"),
            "w": ii.get("width"), "h": ii.get("height"), "mime": ii.get("mime"),
            "bytes": ii.get("size"),
            "url": ii.get("url", "").split("?")[0],
            "lic": strip(em.get("LicenseShortName", {}).get("value", "")),
            "licurl": strip(em.get("LicenseUrl", {}).get("value", "")),
            "artist": strip(em.get("Artist", {}).get("value", ""))[:150],
            "date": strip(em.get("DateTimeOriginal", {}).get("value", ""))[:100],
            "desc": strip(em.get("ImageDescription", {}).get("value", ""))[:300],
        }
        out[rec["title"]] = rec
        print(f"{rec['w']}x{rec['h']} {rec['bytes']/1024/1024:.1f}MB {rec['lic'][:16]:16s} {rec['title'][:78]}")
    time.sleep(3)

cache = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_cache")
with open(os.path.join(cache, "_candidates.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print("WROTE", len(out))
