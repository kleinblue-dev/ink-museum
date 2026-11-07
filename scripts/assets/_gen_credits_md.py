# -*- coding: utf-8 -*-
"""生成项目根 CREDITS.md（人读版出处）。数据源：_cache/commons-meta.json + 实际文件。"""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))  # ink-museum
meta = {}
mp = os.path.join(HERE, "_cache", "commons-meta.json")
if os.path.exists(mp):
    meta = json.load(open(mp, encoding="utf-8"))

WORKS = [
    dict(id="entry", scene="入馆", title="富春山居图（无用师卷）", en="Dwelling in the Fuchun Mountains",
         artist="黄公望", dynasty="元", year="1347–1351", museum="台北故宫博物院",
         commons="富春山居圖(無用師卷).jpg",
         note="卷首远岫与江面（tall）取同卷开卷段；wide 取卷中主峰与洲渚，右移 400px 避开扫描拼缝。"),
    dict(id="spring", scene="早春", title="早春图", en="Early Spring",
         artist="郭熙", dynasty="北宋", year="1072（熙宁五年）", museum="台北故宫博物院",
         commons="Guo Xi - Early Spring, upscaled.jpg",
         note="wide 取中部山体与飞瀑横带；tall 为整幅竖轴（略去上下题印边缘）。裁掉四周藏印与乾隆题诗区域。"),
    dict(id="water", scene="静水", title="水图 · 秋水迥波", en="Water Album: The Waving Surface of the Autumn Flood",
         artist="马远", dynasty="南宋", year="12–13 世纪", museum="北京故宫博物院（册页）",
         commons="Ma Yuan - Water Album - The Waving Surface of the Autumn Flood.jpg",
         note="裁去左侧题名与藏印；册页照片的 3 处竖向拼缝/折缝用邻近纹理羽化克隆修补。"),
    dict(id="bamboo", scene="疏竹", title="墨竹图", en="Ink Bamboo",
         artist="文同", dynasty="北宋", year="11 世纪", museum="台北故宫博物院",
         commons="Wen Tong Babmbuk.jpg",
         note="裁去上部王直/王鏊题跋；wide 取竹枝横段（右上留白压字），tall 竖裁竹枝主体。"),
    dict(id="pavilion", scene="空亭", title="容膝斋图", en="Rongxi Studio",
         artist="倪瓒", dynasty="元", year="1372（洪武五年）", museum="台北故宫博物院",
         commons="Ni Zan. The Rongxi Studio.1372. 74,7x35,3. National Palace Museum, Taipei.jpg",
         note="裁去上部倪瓒自题与四周藏印；wide 取疏林、空亭、水面（右侧留白），tall 保持竖轴空亭。"),
]

def kb(path):
    return os.path.getsize(path) / 1024

def fmt_kb(path):
    return f"{kb(path):.1f} KB"

lines = []
A = lines.append
A("# 出处与授权 · CREDITS")
A("")
A("「墨馆」的场景背景取自 **Wikimedia Commons 公有领域**（PD-old / PD-Art / CC0）的中国宋元水墨名作；")
A("墨块取自《芥子园画传》（清代刻本，公有领域）。")
A("所有背景均由 `scripts/assets/fetch_and_compose.py` 自动下载、裁切、调色、压缩；")
A("下载 / 处理 / 出图可完全复现，产物清单与机器可读出处见 `assets/CREDITS.json`。")
A("")
A("> 本项目不包含任何非公有领域图像素材；运行时零外部请求（只用本站资源）。")
A("")
A("## 一、作品与出处")
A("")
for w in WORKS:
    m = meta.get(w["commons"], {})
    page = m.get("pageUrl") or ("https://commons.wikimedia.org/wiki/File:" + w["commons"].replace(" ", "_"))
    direct = m.get("fileUrl") or "（见 Commons 文件页）"
    lic = m.get("license") or "Public domain"
    A(f"### {w['scene']} · 《{w['title']}》")
    A("")
    A(f"- 作者：{w['artist']}　朝代：{w['dynasty']}　年代：{w['year']}　藏地：{w['museum']}")
    A(f"- Commons 文件页：<{page}>")
    A(f"- 原始文件直链：<{direct}>")
    A(f"- 许可证：**{lic}**（PD-old / PD-Art，公有领域；Commons 元数据声明 Public domain 或 CC0）")
    A(f"- 裁切 / 处理说明：{w['note']}")
    A(f"- 产物：")
    for kind, size in (("wide", "1600×900"), ("tall", "900×1440"), ("thumb", "640×420")):
        p = os.path.join(ROOT, "assets", "bg", f"{w['id']}-{kind}.webp")
        A(f"  - `assets/bg/{w['id']}-{kind}.webp` — {size}，{fmt_kb(p)}")
    A("")

A("## 二、程序生成资产（无第三方权利）")
A("")
A("| 文件 | 尺寸 | 大小 | 说明 |")
A("|---|---|---|---|")
scroll_rows = [("assets/bg/scroll-wide.webp", "1600×900", "收卷底：宣纸纹理，供画卷预览叠墨迹"),
               ("assets/bg/scroll-tall.webp", "900×1440", "同上，竖屏版"),
               ("assets/paper-tile.webp", "512×512", "可无缝平铺纸纹"),
               ("assets/icons/icon-192.png", "192×192", "朱砂印章「墨」PWA 图标"),
               ("assets/icons/icon-512.png", "512×512", "同上，大尺寸")]
for rel, size, desc in scroll_rows:
    p = os.path.join(ROOT, rel)
    A(f"| `{rel}` | {size} | {fmt_kb(p)} | {desc} |")
A("")
A("生成方式：FFT 低通噪声云斑 + 纸纤维线 + 轻暗角（宣纸底 / 纸纹）；")
A("纸底 + 朱砂方章（随机磨损）+ 阴文「墨」（系统楷体渲染为位图）+ 轻微旋转（图标）。")
A("全部由 `scripts/assets/fetch_and_compose.py` 逐字节确定地生成，不含任何图片素材。")
A("")

A("## 三、最终文件清单")
A("")
A("| 文件 | 尺寸 | 大小 | 对应作品 |")
A("|---|---|---|---|")
rows = []
for w in WORKS:
    for kind, size in (("wide", "1600×900"), ("tall", "900×1440"), ("thumb", "640×420")):
        rel = f"assets/bg/{w['id']}-{kind}.webp"
        p = os.path.join(ROOT, rel)
        rows.append((rel, size, fmt_kb(p), f"{w['artist']}《{w['title']}》"))
for rel, size, desc in scroll_rows:
    p = os.path.join(ROOT, rel)
    rows.append((rel, size, fmt_kb(p), "程序生成"))
for rel, size, kbv, work in rows:
    A(f"| `{rel}` | {size} | {kbv} | {work} |")
A("")
A("## 四、通用处理动作（每张背景都经过）")
A("")
A("1. 裁掉色卡 / 边框 / 装裱 / 题跋 / 藏印区域（精确裁切框见 `assets/CREDITS.json` 的 `derivatives[].crop`）。")
A("2. 竖向扫描 / 册页拼缝以邻近纹理羽化克隆修补（水图册页）。")
A("3. 亮度中值去噪（消扫描颗粒，保留墨线边缘）。")
A("4. 低通光照场校正（去扫描拼缝亮度台阶与老照片光照不均）。")
A("5. 暖纸白平衡 + 近单色双色调（纸白 `#f2e8d8` / 深墨 `#1c1813`，按亮度在两色间插值）。")
A("6. 轻度锐化保墨线清晰；径向暗角 ≤12%；必要时末道柔化以压体积。")
A("7. 二分质量编码 WebP（method=6），保证每张不超过 SPEC §7 预算。")
A("")
A("**不在图上添加任何文字、水印或边框。** 原画中的藏印、纸色、绢纹等物质痕迹按博物馆展陈逻辑保留或裁除，")
A("并在上表逐条注明。")
A("")
A("## 五、可复现")
A("")
A("```powershell")
A("$env:HTTPS_PROXY='http://127.0.0.1:7897'   # 首次下载源图")
A("E:\\AI\\Python311\\python.exe scripts\\assets\\fetch_and_compose.py")
A("```")
A("")
A("构建与换画说明见 `scripts/assets/README.md`。")
A("")
out = os.path.join(ROOT, "CREDITS.md")
open(out, "w", encoding="utf-8", newline="\n").write("\n".join(lines))
print("wrote", out, len(lines), "lines")
