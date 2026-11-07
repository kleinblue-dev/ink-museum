# -*- coding: utf-8 -*-
"""1) 分析 entry_full 上下边缘；2) 找竖向拼缝；3) 下载 entry_alt 高分辨率版本供对比。"""
import os, sys, time, urllib.parse, urllib.request
import numpy as np
from PIL import Image
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "_cache", "raw")
im = Image.open(os.path.join(RAW, "entry_full.jpg")).convert("RGB")
a = np.asarray(im, dtype=np.float32) / 255.0
# 行亮度均值（全宽）
row = a.mean(axis=(1, 2))
print("rows 0-30:", np.round(row[:30], 3))
print("rows -30:", np.round(row[-30:], 3))
# 列梯度找拼缝
col = a.mean(axis=(0, 2))
d = np.abs(np.diff(col))
# 平滑后找峰值
k = np.ones(9) / 9
ds = np.convolve(d, k, mode="same")
thr = ds.mean() + 4 * ds.std()
peaks = [int(i) for i in np.where(ds > thr)[0]]
# 合并相邻
merged = []
for p in peaks:
    if merged and p - merged[-1] < 40:
        merged[-1] = (merged[-1] + p) // 2
    else:
        merged.append(p)
print("seam candidates:", merged[:60])
print("seam count:", len(merged))
# 下载 entry_alt 高分辨率
UA = {"User-Agent": "ink-museum-curator/1.0 (local build; contact: none)"}
out = os.path.join(RAW, "entry_alt_2000.png")
if not os.path.exists(out):
    url = "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote("元黃公望富春山居圖 卷.png", safe="") + "?width=2000"
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as r:
        data = r.read()
    open(out, "wb").write(data)
    print("downloaded", len(data))
else:
    print("alt exists", os.path.getsize(out))
im2 = Image.open(out); print("entry_alt_2000:", im2.size)
