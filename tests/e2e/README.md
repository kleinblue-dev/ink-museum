# 墨馆 E2E 测试（tests/e2e）

浏览器端到端验收，对应 `docs/SPEC.md` §8 验收门第 3/4/7 条。当前实现「早期冒烟」，完整流程验收（enter→reveal、落墨/撤销、保存、馆藏墙、about、刷新恢复、reduced-motion、standalone）在 Lead 派发最终验收任务后扩展。

## 前置

- Windows + Node ≥ 22（本机 v24）
- 系统 Chrome（默认 `C:\Program Files\Google\Chrome\Application\chrome.exe`，可用 `CHROME_PATH` 覆盖）
- **不下载 Playwright 自带浏览器**：只装 `playwright-core` 并传 `executablePath` 用系统 Chrome。

```powershell
cd ink-museum
# 需要代理时（本机 127.0.0.1:7897）
$env:HTTPS_PROXY='http://127.0.0.1:7897'
$env:HTTP_PROXY='http://127.0.0.1:7897'
npm install --no-save playwright-core
```

`--no-save` 不写 `package.json`；`node_modules/` 与 `_qa-artifacts/` 已在 `.gitignore` 里。

## 运行

```powershell
cd ink-museum
node tests/e2e/run.mjs                      # 早期冒烟（默认 suite=early）
node tests/e2e/run.mjs --suite=early --headed   # 有头调试
node tests/e2e/run.mjs --base=http://127.0.0.1:8791
node tests/e2e/run.mjs --out=_qa-artifacts/early --keep
npm run qa                                  # 等价于 node tests/e2e/run.mjs
```

参数：

| 参数 | 说明 |
|---|---|
| `--suite=early` | 测试套件；目前只实现 `early`（`full` 待最终验收任务扩展） |
| `--base=<url>` | 目标站点，默认 `http://127.0.0.1:8790` |
| `--out=<dir>` | 产物目录，相对项目根；默认 `_qa-artifacts/<suite>`（默认会先清空该目录） |
| `--headed` | 有头模式（默认 headless） |
| `--keep` | 不清理已有产物目录 |
| `--help` | 帮助 |

## dev server 管理（无需手工起服务）

`harness.mjs` 的 `ensureServer()` 按优先级处理：

1. **复用**（`mode=reuse`）：`--base` 指向的地址已有 HTTP 响应（任意状态码）→ 直接复用，**不杀**现有进程。
2. **后端**（`mode=spawned`）：`server/index.mjs` 存在 → spawn `node server/index.mjs`（`PORT`/`HOST` 取自 `--base`），最多等 30s；结束时**按 PID** 关闭自己启动的进程（Windows 用 `taskkill /PID <pid> /T /F` 兜底）。
3. **项目自带 local 静态**（`mode=spawned-static`）：后端还没就绪但 `scripts/serve-static.mjs` 存在 → 用它托管前台（local 模式，无 `/api`，CSP 与线上一致）。
4. **兜底静态服务**（`mode=fallback-static`）：两个入口都不存在（早期阶段）→ harness 内置静态服务器托管项目根，`/api/*` 不可用；页面 404/空壳按真实情况记录，不伪造通过。

自动启动的服务日志写到 `<out>/server.log`；复用已有服务时不写日志、也不关停。

服务日志写到 `<out>/server.log`。

## 产物（默认 `_qa-artifacts/early/`）

```
_qa-artifacts/early/
├─ result.json                              # 机器可读完整结果（唯一权威）
├─ server.log                               # 本次 dev server 输出（如自动启动/兜底）
├─ early-desktop-1440x900.png               # 三视口截图
├─ early-desktop-1440x900.html              # 对应 DOM 快照（排障用）
├─ early-mobile-390x844.png / .html
└─ early-narrow-320x640.png / .html
```

## result.json 字段

| 字段 | 说明 |
|---|---|
| `suite` / `ok` / `exitCode` | 套件名、是否全过、退出码 |
| `startedAt` / `finishedAt` / `durationMs` | 运行时间 |
| `target` | `baseURL` + `targetPath`（早期冒烟为 `/?fresh=1`） |
| `env` | Node/平台/产物目录/playwright-core 版本/Chrome 路径与版本/headless |
| `server` | `{mode: reuse\|spawned\|spawned-static\|fallback-static, baseURL, startedByUs, pid, warnings, serverLog}` |
| `projectSnapshot` | 本次测试时的代码版本证据：关键文件 size/mtime/sha256_16，目录文件数 |
| `viewports[]` | 每个视口一条：`viewport`、`requestedUrl`、`navStatus`、`navError`、`pageInfo`（title/bodyText/elementCount/scrollWidth/horizontalOverflow/localStorageKeys 等）、`screenshot`、`console[]`、`consoleErrors[]`、`pageErrors[]`、`requestFailures[]`、`failedResponses[]`、`externalRequests[]`、`htmlSnapshot` |
| `checks[]` | 断言列表：`{id, description, status: pass|fail, detail}` |
| `failures[]` | `checks` 中失败项摘要 |
| `warnings[]` | 非阻断提示（如后端未就绪、记录到 404） |
| `resources` | 聚合后的 console/pageerror/外链/requestfailed/>=400 响应 |
| `hints` | 早期记录型证据（横向溢出、pageInfo 摘要） |
| `artifacts` | `result` 与 `screenshots` 的相对路径 |

## 退出码

| 码 | 含义 |
|---|---|
| `0` | 全部 check 通过 |
| `1` | 有 check 失败（页面 404、console error、外站请求等） |
| `2` | 基建不可用：playwright-core 未安装、Chrome 找不到/起不来、dev server 起不来、产物目录非法 |

示例：`$LASTEXITCODE` / `echo $?` 判断；CI 里把非 0 当失败即可，2 单独报警。

## 早期冒烟（suite=early）检查项

打开 `/?fresh=1`，三个视口各跑一遍（1440×900 / 390×844 / 320×640）：

| check id | 含义 |
|---|---|
| `http.status.200` | 主文档返回 HTTP 200 |
| `page.title` | 有真实标题（不是浏览器回退的 URL 标题） |
| `page.title.museum` | 标题含「墨馆」 |
| `console.noErrors` | 控制台无 error |
| `page.noPageErrors` | 无未捕获 pageerror |
| `network.noExternalRequests` | 无外站请求（只允许本站 origin，localhost/127.0.0.1 视为同站） |
| `screenshots.3viewports` | 三视口截图齐全 |
| `page.hasContent` | 页面有可见内容（非 404/空壳） |

前端未写完时允许 404/空壳：此时如实 FAIL（exit 1），`warnings`/`resources` 里记录缺失资源与请求失败，不伪造通过。

## Full suite（suite=full，已实现，2026-11-07 已跑最终验收）

> 状态：**已实现并执行过**（`node tests/e2e/run.mjs --suite=full`，产物默认 `_qa-artifacts/final/`，结果写入 `docs/QA_REPORT.md`）。
> 本机最终验收结果：156 checks / 155 PASS / 1 偶发（满负载下 `npm test` 单用例进程超时，单独复跑 93/93）。

Lead 派发最终验收任务后实现；harness 已具备能力，`run.mjs` 增加 `--suite=full`。预期跑法（实现时定稿）：

```powershell
# local 模式段：scripts/serve-static.mjs 托管前台，保存走本机馆藏
node tests/e2e/run.mjs --suite=full --out=_qa-artifacts/final/local

# server 模式段：server/index.mjs + 临时 DATA_DIR（跑完清理，不污染 server/data/）
node tests/e2e/run.mjs --suite=full --out=_qa-artifacts/final/server --base=http://127.0.0.1:8790
```

两段产物分目录落盘；最终把结论 + 证据路径 + 失败项 + 阻塞项写进 `docs/QA_REPORT.md`。

### SPEC §8 九条验收门 → 用例清单

| # | SPEC §8 验收门 | 用例 id | 做法 | 通过标准 |
|---|---|---|---|---|
| 1 | `node --test server/tests/` 全绿 | `unit.server` | spawn `node --test server/tests/`（临时 DATA_DIR、随机端口） | exit 0，无 fail |
| 2 | `validate-content.mjs` 0 错误 | `unit.content` | spawn `node scripts/validate-content.mjs` | exit 0，stdout 无 error |
| 3 | 浏览器 E2E 全流程 | `e2e.*`（下节拆细） | 桌面 1440×900 / 手机 390×844 / 窄屏 320×640 | 全部 pass |
| 4 | 运行时网络零外链 | `network.zeroExternal` | 全流程收集请求，origin 白名单=自站（127.0.0.1/localhost） | 外站请求数 = 0 |
| 5 | 资产预算首屏 ≤600KB / 全站 ≤6MB | `assets.firstScreen` / `assets.total` | `PerformanceResourceTiming` + response body 字节，URL 去重；首屏=load 前资源 | 两门都达标 |
| 6 | 可访问性 | `a11y.buttonNames` / `a11y.keyboardFlow` / `a11y.reducedMotion` | role/name 定位按钮；纯键盘走完非绘画流程；`reducedMotion:'reduce'` context 测切步 | 按钮有可读名称；键盘可完成；reduced-motion 切步 ≤50ms 且无长 transition |
| 7 | 移动端 320/375/430 无横向滚动；画布 touch 不打断页面滚动 | `mobile.noHScroll` / `mobile.touchNoPageScroll` | 三视口 `scrollWidth <= innerWidth+1`；画布上 touchmove 前后 `scrollY` 不变 | 无横向滚动；画布 touch 不滚动页面 |
| 8 | `build-standalone.mjs` → `dist/standalone.html` 双击可用 | `standalone.build` / `standalone.file` | 先构建；再用 `file:///.../dist/standalone.html` 打开 | 构建 exit 0；file:// 下 console error=0 且 enter 步可见可点 |
| 9 | 文档齐备 | `docs.exist` | 检查 README / docs/API.md / docs/REA_MUSEUM.md / CREDITS.md / docs/QA_REPORT.md | 全部存在且非空 |

### §8.3 浏览器 E2E 用例（拆细）

| 用例 id | 场景 | 关键断言 | 证据 |
|---|---|---|---|
| `e2e.enter` | 打开 `/?fresh=1` | 标题含「墨馆」、入馆可点、零 console error/pageerror | 三视口截图 |
| `e2e.pre.sliders` | pre 步三滑杆 | 三个都碰过才能继续（只碰两个点下一步应停留）；值 1–7；持久化 | 截图 + localStorage 快照 |
| `e2e.scene.select` | 择境四画卡 | 选中态正确；背景 `<picture>` 按视口切 wide/tall；无破图 | 截图 |
| `e2e.line.reply` | 一句 | 第二句承接出现；「落墨」可点 | 截图 |
| `e2e.ink.stroke` | 画布落笔 | `engine.stats().strokes` 增加；画布像素变化非全空 | 画布前后截图 |
| `e2e.ink.undo` | 撤销 | strokes 回落；像素回到落笔前（容差） | 前后截图 diff |
| `e2e.ink.clear` | 重来 | 画布清空后仍可收笔 | 截图 |
| `e2e.post.mood` | 此刻 | 滑杆 + 四选一必选，成功进 reveal | 截图 |
| `e2e.reveal.export` | 收卷 | 合成画卷非空白（尺寸>0、非纯色）、含落款/印章/日期 | 导出图 + 截图 |
| `e2e.save.local` | 存馆藏（local） | localStorage 馆藏 +1，提示文案正确 | localStorage 快照 |
| `e2e.save.server` | 存馆藏（server） | POST 201；`GET /api/scrolls` 出现；馆藏墙卡片可见 | 网络记录 + 截图 |
| `e2e.gallery.overlay` | `#gallery` | 深链可开、可关、回原页 | 截图 |
| `e2e.about.overlay` | `#about` | 可开/可关；有隐私/出处/前身链接；不破版 | 截图 |
| `e2e.resume.reload` | ink 后刷新 | 恢复到原 step；墨迹不恢复且提示「墨已干」 | localStorage + 截图 |
| `e2e.reveal.lock` | reveal 之后 | 不可回退、展示数据不可改 | 截图 |
| `e2e.fresh` | `?fresh=1` | 清空 session，从 enter 重开 | localStorage 快照 |

### 实现要点（先记下）

- 一律用真实用户操作（点击/键盘/pointer events），不读产品内部全局变量；状态断言以 `localStorage['ink-museum.session.v1']` + 可见 DOM 为准（SPEC §2 契约）。
- 选择器优先 role/name；若前端缺稳定选择器，先向 Lead 申请 frontend 加 `data-testid`（QA 不改产品代码）。
- server 模式用临时 `DATA_DIR` + 随机端口，跑完清理，不污染 `server/data/`。
- 每个用例独立采集 console/pageerror/外链；单 case 失败不中断，继续跑后续，最后汇总全量失败面（exit 1）。
- 窄屏 / reduced-motion 等上下文按用例单独 `newContext`，避免相互污染。
- 产物统一落 `_qa-artifacts/final/`（每用例截图 + JSON 片段 + 汇总 result.json），`docs/QA_REPORT.md` 引用相对路径。

## 排障

- **`playwright-core 不可用`**：在 `ink-museum/` 下执行 `npm install --no-save playwright-core`（走代理时设 `HTTPS_PROXY`）。不要 `npx playwright install`。
- **`未找到系统 Chrome`**：设 `$env:CHROME_PATH='...\chrome.exe'`。
- **`Chrome 启动失败`**：确认无残留 Chrome 进程占用 profile；重试即可（每次用全新临时 profile）。
- **8790 被占**：先确认是不是自己的 dev server；或 `--base` 指向其他端口。
- **截图是 404 页**：说明前端/后端还没就绪，看 `result.json.projectSnapshot` 与 `server.mode`。
- 时区固定 `Asia/Shanghai`、locale `zh-CN`、`colorScheme: light`，截图可跨机比较。