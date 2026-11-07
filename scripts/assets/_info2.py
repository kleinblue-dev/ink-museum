import json, re, sys, time, urllib.parse, urllib.request
from html import unescape
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
API = "https://commons.wikimedia.org/w/api.php"; UA = {"User-Agent": "ink-museum-curator/1.0 (local build; contact: none)"}
def strip(h): return unescape(re.sub(r"<[^>]+>", "", h or "")).strip()
def api(params, tries=5):
    params = dict(params, format="json"); url = API + "?" + urllib.parse.urlencode(params)
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r: return json.load(r)
        except Exception as e: print("retry", i, e, file=sys.stderr); time.sleep(6*(i+1))
    return {}
T = ["File:浙博藏剩山图, 2023-09-26 01.jpg", "File:Dwelling in the Fuchun Mountains (only mountain part).jpg",
     "File:富春山居圖(剩山圖).jpg", "File:Dwelling in the Fuchun Mountains 3.jpg"]
d = api({"action":"query","titles":"|".join(T),"prop":"imageinfo","iiprop":"url|size|mime|extmetadata"})
for p in d.get("query",{}).get("pages",{}).values():
    ii = p.get("imageinfo",[{}])[0]
    if not ii: print("MISSING", p.get("title")); continue
    em = ii.get("extmetadata",{})
    print(ii.get("width"), ii.get("height"), f"{ii.get('size',0)/1e6:.1f}MB", strip(em.get("LicenseShortName",{}).get("value","")), p["title"])
    print("   ", ii.get("url","").split("?")[0])
    print("   artist:", strip(em.get("Artist",{}).get("value",""))[:80], "| date:", strip(em.get("DateTimeOriginal",{}).get("value",""))[:60])
