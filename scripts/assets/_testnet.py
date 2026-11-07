# -*- coding: utf-8 -*-
"""测试：直接下载 Special:FilePath 缩略图 + HTML 搜索页可达性。"""
import sys, time, urllib.parse, urllib.request, os
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
UA = {"User-Agent": "ink-museum-curator/1.0 (local build; contact: none)"}
cache = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_cache")

def get(url, path=None, timeout=90):
    req = urllib.request.Request(url, headers=UA)
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
        print(f"  {r.status} {len(data)/1024:.0f}KB {time.time()-t0:.1f}s {r.headers.get('Content-Type')} {url[:110]}")
        if path:
            with open(path, "wb") as f:
                f.write(data)
        return data

# 1) Special:FilePath thumbnail
try:
    get("https://commons.wikimedia.org/wiki/Special:FilePath/Guo%20Xi%20-%20Early%20Spring%2C%20upscaled.jpg?width=1200",
        os.path.join(cache, "test_spring.jpg"))
except Exception as e:
    print("  ERR filepath:", e)

time.sleep(2)
# 2) HTML search page
try:
    d = get("https://commons.wikimedia.org/w/index.php?search=Wen+Tong+bamboo&title=Special:MediaSearch&type=image", None)
    print("  html head:", d[:300].decode("utf-8", "replace").replace("\n", " "))
except Exception as e:
    print("  ERR htmlsearch:", e)
