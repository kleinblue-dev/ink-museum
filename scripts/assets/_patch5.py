import io
p = r"C:\Users\samcz\Documents\deepseek-harness\default-workspace\ink-museum\scripts\assets\fetch_and_compose.py"
s = io.open(p, encoding="utf-8").read()
start = s.index('    {\n        "id": "bamboo",')
end = s.index(']\n\n# ---------------------------------------------------------------- 图像工具')
new = '''    {
        "id": "bamboo",
        "work": {
            "title": "墨竹图", "titleEn": "Ink Bamboo",
            "artist": "文同", "dynasty": "北宋", "year": "11 世纪",
            "museum": "台北故宫博物院",
        },
        "sources": [
            {"cache": "bamboo_wentong.jpg", "commons": "Wen Tong Babmbuk.jpg",
             "width": None, "expect": (1830, 2880)},
        ],
        "wide": {"cache": "bamboo_wentong.jpg", "box": (0.0, 0.205, 1.0, 0.5623),
                 "note": "裁去上部题跋，取竹枝横段；右上留白压字", "finish_blur": 0.5},
        "tall": {"cache": "bamboo_wentong.jpg", "box": (0.10, 0.20, 0.8721, 0.985),
                 "note": "竖裁竹枝主体，避开左右缘与下部藏印", "finish_blur": 0.5},
        "tone": {"white_pct": 78.0, "black_pct": 0.3, "contrast": 1.10, "sharpen": 0.45},
    },
    {
        "id": "pavilion",
        "work": {
            "title": "容膝斋图", "titleEn": "Rongxi Studio",
            "artist": "倪瓒", "dynasty": "元", "year": "1372（洪武五年）",
            "museum": "台北故宫博物院",
        },
        "sources": [
            {"cache": "pavilion.jpg",
             "commons": "Ni Zan. The Rongxi Studio.1372. 74,7x35,3. National Palace Museum, Taipei.jpg",
             "width": None, "expect": (1788, 3674)},
        ],
        "wide": {"cache": "pavilion.jpg", "box": (0.04, 0.515, 0.96, 0.7668),
                 "note": "裁去上部自题藏印，取疏林、空亭、水面；右侧留白", "finish_blur": 0.5},
        "tall": {"cache": "pavilion.jpg", "box": (0.15, 0.44, 0.7249, 0.8877),
                 "note": "竖裁疏林与空亭，亭在右下，上部留白", "finish_blur": 0.5},
        "tone": {"white_pct": 98.0, "black_pct": 0.2, "contrast": 1.16, "sharpen": 0.55},
    },
'''
s = s[:start] + new + s[end:]
io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("config replaced OK")
