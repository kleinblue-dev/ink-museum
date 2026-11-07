# 墨馆 ink-museum

**一座可以走进的水墨小馆。** 选一幅宋元名作当展厅，在画上落墨，留一句话，收成一卷自己的画，存进馆藏。

- 线上：<https://kleinblue-dev.github.io/ink-museum/>（静态前台，local 模式即可完整使用）
- 前身：[墨间 · 一段与自己的相处](https://kleinblue-dev.github.io/mojian/) × [墨心 · 水墨小游戏](https://kleinblue-dev.github.io/ink-mind/)
- 融合方式：**墨间**给仪式与前后自评结构，**墨心**给芥子园墨块 + 自由笔的落墨引擎；外面加一层博物馆展陈（一画入口 / 全幅优先 / 展签文字 / 收卷留痕 / 出处可见），方法见 [docs/REA_MUSEUM.md](docs/REA_MUSEUM.md)。

> 这是一段自我陪伴的练习，**不是医疗建议**，不替代任何专业支持。页面不打分、不评级、不诊断。

---

## 3 分钟开始

```powershell
cd ink-museum
node server/index.mjs            # http://127.0.0.1:8790  前台 + API + 馆藏（推荐）
```

只想看静态页面（GitHub Pages 同款、无馆藏墙）：

```powershell
node scripts/serve-static.mjs    # 或任意静态服务器：python -m http.server 8000
```

想要一个能双击打开、断网也能玩的单文件：

```powershell
node scripts/build-standalone.mjs
# → dist/standalone.html（CSS/JS/图片/墨块全部内联，双击即开）
```

## 改东西（90% 的需求只需要改一个文件）

| 想改什么 | 改哪里 | 说明 |
|---|---|---|
| 任何一句文案、按钮、诗、厅名 | `content/content.js` | 唯一内容源，前台与后端共用；改完刷新即生效 |
| 四个展厅的顺序/数量/名字/墨色 | `content/content.js` 的 `scenes[]` | 增删场景要同时提供对应 `assets/bg/<id>-*.webp` |
| 换背景画作 | `assets/bg/` + `scripts/assets/fetch_and_compose.py` | 脚本从 Wikimedia Commons 取公有领域画作，统一调色后输出 wide/tall/thumb |
| 视觉/字号/留白/动效 | `css/` | 设计 token 在 `css/tokens.css`；不要引入外部字体与 CDN |
| 落墨手感/墨块 | `js/ink/` + `data/masks.json` | 掩膜数据由墨心提取，改引擎见 `docs/SPEC.md` §4 |
| 前后自评题目 | `content/content.js` 的 `pre/post` | 默认三项：紧/累/乱；改 key 需同步 `server` 校验范围 |
| 后端存储/限流/接口 | `server/` + `docs/API.md` | 零依赖 Node；数据在 `server/data/`（已 gitignore） |
| 单文件离线版 | `node scripts/build-standalone.mjs` | 构建约定见脚本头部注释 |

**文案纪律**：每屏可见中文 ≤90 字，一屏一个标题 + 至多一行正文，按钮 2–4 字；关于页是唯一的长文本仓库。校验：`node scripts/validate-content.mjs`。

## 前后端怎么分工

```
content/content.js ──┬── import ──> 前台 js/（浏览器）
                     └── import ──> 后端 server/（Node，同源 API）
前台是 local-first：无 API 时自动降级本机 localStorage（GitHub Pages 就这样）；
有 `/api/health` 时自动进 server 模式，收卷可 POST 进馆藏墙。
```
- 前台：原生 ES module + CSS，无构建步骤、运行时零外链；`js/` 目录即全部逻辑。
- 后端：零依赖 Node ≥22，`node server/index.mjs`；同一端口托管前台 + `/api/*`；存储 = `server/data/scrolls.jsonl` + WebP 图片文件。
- 接口：`GET /api/health|content|scrolls|scrolls/:id|stats`、`POST /api/scrolls`（幂等键、限流、无自由文本）。详见 [docs/API.md](docs/API.md)。

## 测试与验收

```powershell
node scripts/validate-content.mjs        # 内容纪律 + 资产预算（缺资产会被拦）
node --test server/tests/                # 后端单元/接口测试
node --test tests/unit/                  # 前台纯逻辑测试 + 引擎单元测试
node tests/e2e/run.mjs                   # 浏览器 E2E（需本机 Chrome）
node scripts/build-standalone.mjs        # 单文件离线版 + 残留引用检查
```

验收门与 QA 报告见 [docs/SPEC.md](docs/SPEC.md) §8、[docs/QA_REPORT.md](docs/QA_REPORT.md)。

## 发布到 GitHub Pages

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy-pages.ps1
```
- 仓库：`kleinblue-dev/ink-museum`（public），Pages 源 = `main` 分支 `/ (root)`，`.nojekyll` 已就位。
- 发布后线上为静态前台（local 模式）；若要公开馆藏墙，把 `server/` 部署到任意 Node 主机，并把前台 API 探测指向同源即可。
- 旧站保持在线，关于页底部链回墨间/墨心。

## 隐私与边界

- 默认**零上传**：作答与墨迹只存本机 `localStorage`；只有点「存进馆藏」才上传画卷 + 匿名编号 + 前后自评，不含姓名/手机号等身份信息。
- 运行时**零外部请求**：无 CDN、无外部字体、无埋点；背景图全部是本站 WebP。
- 背景画作均为**公有领域**（宋元名作 + 《芥子园画传》清代刻本），逐张出处见 [CREDITS.md](CREDITS.md)。
- 这是自我陪伴练习，不是医疗器械/心理治疗；不宣称疗效。

## 出处

- 背景：黄公望《富春山居图》、郭熙《早春图》、马远《水图》、文同《墨竹图》、倪瓒《容膝斋图》——公有领域，来源见 CREDITS。
- 墨块：整理自《芥子园画传》白描页（清代刻本，公有领域），数据沿用自墨心项目。
- 前身：墨间（8 步闭环原型）· 墨心（单文件水墨小游戏），均为 kleinblue-dev 作品。
- 整理、程序与整体设计：**kleinblue-dev**，保留所有权利；引用与再发布请先联系。
