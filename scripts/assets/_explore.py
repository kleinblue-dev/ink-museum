# -*- coding: utf-8 -*-
"""临时勘探脚本 v2：搜索候选 + imageinfo，结果写 JSON，控制台只打 ASCII 安全信息。"""
import json, re, sys, urllib.parse, urllib.request, os
from html import unescape
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "ink-museum-curator/1.0 (local build; contact: none)"}
OUT = {"queries": {}, "files": {}}

def api(params):
    params = dict(params, format="json")
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

def strip(html):
    return unescape(re.sub(r"<[^>]+>", "", html or "")).strip()

QUERIES = {
    "entry": ["Dwelling in the Fuchun Mountains", "Huang Gongwang Fuchun", "富春山居图"],
    "spring": ["Guo Xi Early Spring", "郭熙 早春图"],
    "water": ["Ma Yuan Water Album", "马远 水图"],
    "bamboo": ["Wen Tong bamboo", "文同 墨竹", "Ke Jiusi bamboo"],
    "pavilion": ["Ni Zan Rongxi Studio", "倪瓒 容膝斋图", "Ni Zan Studio"],
}
CATS = ["Category:Dwelling in the Fuchun Mountains", "Category:Water Album by Ma Yuan",
        "Category:Ni Zan", "Category:Wen Tong", "Category:Ke Jiusi", "Category:Guo Xi"]

def imageinfo(titles):
    out = []
    for i in range(0, len(titles), 10):
        chunk = titles[i:i+10]
        try:
            data = api({"action": "query", "titles": "|".join(chunk),
                        "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata",
                        "iiurlwidth": 1000})
        except Exception as e:
            print("  ERR info", e); continue
        for p in data.get("query", {}).get("pages", {}).values():
            ii = p.get("imageinfo", [{}])[0]
            if not ii: continue
            em = ii.get("extmetadata", {})
            out.append({
                "title": p.get("title"),
                "w": ii.get("width"), "h": ii.get("height"), "mime": ii.get("mime"),
                "url": ii.get("url", "").split("?")[0],
                "lic": strip(em.get("LicenseShortName", {}).get("value", "")),
                "artist": strip(em.get("Artist", {}).get("value", ""))[:120],
                "date": strip(em.get("DateTimeOriginal", {}).get("value", ""))[:80],
                "desc": strip(em.get("ImageDescription", {}).get("value", ""))[:200],
            })
    return out

seen = {}
for key, qs in QUERIES.items():
    print("==", key)
    for q in qs:
        try:
            data = api({"action": "query", "list": "search", "srnamespace": 6,
                        "srlimit": 8, "srsearch": q})
        except Exception as e:
            print("   ERR search", e); continue
        titles = [s["title"] for s in data.get("query", {}).get("search", [])]
        for t in titles:
            if t not in seen:
                seen[t] = imageinfo([t])[0] if True else None
                info = seen[t]
                if info:
                    print(f"  {info['w']}x{info['h']} {info['mime'][6:]:5s} {info['lic'][:14]:14s} {t[:70]}")

for cat in CATS:
    print("== CAT", cat)
    try:
        data = api({"action": "query", "list": "categorymembers", "cmtitle": cat,
                    "cmtype": "file", "cmlimit": 30})
    except Exception as e:
        print("   ERR cat", e); continue
    titles = [s["title"] for s in data.get("query", {}).get("categorymembers", [])]
    for t in titles:
        if t not in seen:
            seen[t] = imageinfo([t])[0]
            info = seen[t]
            if info:
                print(f"  {info['w']}x{info['h']} {info['mime'][6:]:5s} {info['lic'][:14]:14s} {t[:70]}")

OUT["files"] = seen
cache = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_cache")
with open(os.path.join(cache, "_explore.json"), "w", encoding="utf-8") as f:
    json.dump(OUT, f, ensure_ascii=False, indent=1)
print("WROTE", len(seen), "files")
