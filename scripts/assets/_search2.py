import json, sys, time, urllib.parse, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "ink-museum-curator/1.0 (local build; contact: none)"}
def api(params, tries=5):
    params = dict(params, format="json")
    url = API + "?" + urllib.parse.urlencode(params)
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.load(r)
        except Exception as e:
            print("retry", i, e, file=sys.stderr); time.sleep(6*(i+1))
    return {}
for q in ["剩山圖", "Fuchun Mountains Huang Gongwang", "富春山居图"]:
    print("== ", q)
    d = api({"action":"query","list":"search","srnamespace":6,"srlimit":12,"srsearch":q})
    for s in d.get("query",{}).get("search",[]):
        print("  ", s["title"])
    time.sleep(2)
