# -*- coding: utf-8 -*-
"""列出相关 Commons 分类成员（只查标题，节约请求）。"""
import json, sys, time, urllib.parse, urllib.request, os
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "ink-museum-curator/1.0 (local build; contact: none)"}

def api(params, tries=4):
    params = dict(params, format="json")
    url = API + "?" + urllib.parse.urlencode(params)
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:
            print("  retry", i, e, file=sys.stderr)
            time.sleep(3 * (i + 1))
    return {}

CATS = ["Category:Dwelling in the Fuchun Mountains",
        "Category:Water Album by Ma Yuan",
        "Category:Ni Zan",
        "Category:Wen Tong",
        "Category:Ke Jiusi"]
res = {}
for cat in CATS:
    print("==", cat)
    data = api({"action": "query", "list": "categorymembers", "cmtitle": cat,
                "cmtype": "file", "cmlimit": 60})
    titles = [m["title"] for m in data.get("query", {}).get("categorymembers", [])]
    res[cat] = titles
    for t in titles:
        print("  ", t)
    time.sleep(1.2)

cache = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_cache")
with open(os.path.join(cache, "_categorymembers.json"), "w", encoding="utf-8") as f:
    json.dump(res, f, ensure_ascii=False, indent=1)
print("done")
