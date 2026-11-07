# scripts/assets · 墨馆视觉资产构建

本目录负责 SPEC §7 的「背景资产」：把 Wikimedia Commons 上的公有领域宋元水墨名作，
统一处理成暖纸白平衡、近单色、可压字的博物馆调性 WebP；另程序生成宣纸底、纸纹、朱砂印章图标。

产物（全部由本目录脚本生成，勿手改）：

```
assets/bg/{entry,spring,water,bamboo,pavilion}-wide.webp    1600×900  ≤200KB（SPEC 上限 220KB）
assets/bg/{entry,spring,water,bamboo,pavilion}-tall.webp     900×1440 ≤172KB（SPEC 上限 180KB）
assets/bg/{entry,spring,water,bamboo,pavilion}-thumb.webp    640×420  ≤57KB（SPEC 上限 60KB）
assets/bg/scroll-wide.webp / scroll-tall.webp                程序生成宣纸底
assets/paper-tile.webp                                       512×512 可平铺纸纹 ≤40KB
assets/icons/icon-192.png / icon-512.png                     朱砂印章「墨」
assets/CREDITS.json                                          机器可读出处分与产物清单
CREDITS.md                                                   人读版出处（项目根）
```

## 依赖与环境

- `E:\AI\Python311\python.exe`（Pillow ≥10、numpy）；无其它依赖。
- 首次下载源图需走构建期代理：

```powershell
$env:HTTPS_PROXY='http://127.0.0.1:7897'
$env:HTTP_PROXY='http://127.0.0.1:7897'
cd ink-museum
E:\AI\Python311\python.exe scripts\assets\fetch_and_compose.py
```

- 源图缓存在 `scripts/assets/_cache/raw/`（已被 `.gitignore` 的 `**/_cache/` 忽略），
  Commons 元数据缓存在 `_cache/commons-meta.json`。脚本幂等：源图命中缓存后，处理与编码逐字节确定，
  重复运行输出一致。

## 常用命令

```powershell
# 全量重建（幂等）
E:\AI\Python311\python.exe scripts\assets\fetch_and_compose.py

# 只重建某几组：entry,spring,water,bamboo,pavilion,scroll,tile,icons
E:\AI\Python311\python.exe scripts\assets\fetch_and_compose.py --only bamboo,pavilion

# 忽略缓存重新下载源图（换画时用）
E:\AI\Python311\python.exe scripts\assets\fetch_and_compose.py --only spring --force-download

# 额外输出预览图到指定目录（调构图用，文件名 *-preview.jpg）
E:\AI\Python311\python.exe scripts\assets\fetch_and_compose.py --only water --preview scripts\assets\_cache\preview
```

脚本退出码：`0` 全部达标；`1` 构建失败；`2` 有文件超预算（仍会落盘并打印 OVER，不会静默降级）。

## 换一幅画 / 调裁切

1. 在 Commons 找到公有领域（PD-old / PD-Art / CC0）文件，记下文件名（如 `Wen Tong Babmbuk.jpg`）。
2. 打开 `fetch_and_compose.py`，在 `ARTWORKS` 列表里改对应条目的 `sources[].commons` 为文件名；
   `expect` 填源图下载后的宽高（首次可先留空跑一次看打印的尺寸，再补上，脚本会校验防止裁错图）。
3. `wide` / `tall` 的 `box` 是**源图归一化坐标** `(left, top, right, bottom)`，各自必须约为：
   - wide `right-left : bottom-top = 16:9`（1600×900）
   - tall `right-left : bottom-top = 0.625`（900×1440，即 5:8）
   比例不严格时脚本会拉伸；建议先用 `--preview` 出预览图确认构图（单张出图约几秒）。
4. `tone` 管调性：`white_pct`（白点百分位，越大纸越亮但对比越强；深色绢本可降到 70-80）、
   `black_pct`（黑点）、`contrast`、`sharpen`；某张压不进预算时可加 `finish_blur: 0.4~0.6`
   （只削极高频纸纹，观感几乎无损）。
5. 源图有竖向扫描拼缝时，给该 source 加 `"seams": [列坐标列表]`，脚本会用邻近纹理羽化克隆修补。
6. 跑 `--only <id> --force-download`，用 `read_image` 看预览，再跑全量。

## 改尺寸 / 预算

- 输出尺寸：脚本顶部 `WIDE / TALL / THUMB`；`thumb` 由 wide 再裁 640:420 缩放，不需要单独配置。
- 预算：脚本顶部 `BUDGET`（字节）。WebP 质量由二分法自动求「不超预算的最高质量」，每次运行会打印 `q=`。
- 改了尺寸/预算后，请同步 `docs/SPEC.md` §7 与 `content/content.js` 里的 `bg` 路径/尺寸说明。

## 处理管线（每个画作）

1. 裁切：去色卡 / 边框 / 装裱 / 题跋 / 藏印区域（切图坐标即 CREDITS.json 的 `crop`）。
2. 修补：竖向扫描/册页拼缝用邻近纹理羽化克隆盖掉（水图册页用）。
3. 亮度中值去噪：消扫描颗粒，同时让 WebP 更压得动。
4. 低通光照场校正：去掉扫描拼缝亮度台阶与老照片光照不均。
5. 暖纸白平衡 + 近单色双色调：纸白 `#f2e8d8`、深墨 `#1c1813`，按亮度在两色间插值。
6. 轻度锐化保墨线；径向暗角 ≤12%；末道柔化（仅体积需要时）。
7. 二分质量编码 WebP（method=6）。

## 程序生成部分

- `scroll-wide/tall.webp`：FFT 低通噪声云斑 + 纸纤维线 + 轻暗角，无字无图案，供收卷页叠墨迹。
- `assets/paper-tile.webp`：512×512 周期噪声 + 环绕绘制纤维，可无缝平铺。
- `assets/icons/icon-{192,512}.png`：纸底 + 朱砂方章（随机磨损）+ 阴文「墨」（系统楷体渲染为位图）+ 轻微旋转。

## 排错

- `HTTP Error 429`：Commons 限流，脚本内置退避重试与元数据缓存；仍失败就隔几分钟再跑。
- `缓存 ... 尺寸 ... != 预期 ...`：换画后源图尺寸变了，按打印尺寸更新 `expect`（或删 `_cache/raw` 下对应文件重下）。
- `无法压到预算内`：给该衍生规格加 `finish_blur` 或降低 `sharpen`，必要时调小 `BUDGET` 之外的尺寸。
- 出图后有竖线：源图拼缝，补 `"seams": [...]`（见上）。
