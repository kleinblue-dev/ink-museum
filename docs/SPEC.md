# 墨馆 ink-museum · 施工规格（唯一接口契约）

> 本文件是团队唯一共享契约。代码以本文件为准；改契约必须先改本文件并通知全员。
> 版本：1.0.0 · 目标：把「墨间 mojian」与「墨心 ink-mind」融成一座可走进去的水墨小馆，前后端可改，上 GitHub Pages。

---

## 0. 一句话

**一座数字水墨馆：选一幅宋元名作当展厅，在画上落墨，留一句话，收成一卷自己的画，可存进馆藏。**

- 融合关系：`墨间` 提供**仪式与测量结构**（来时看一眼 → 择境 → 一句 → 落墨 → 回望 → 收卷）；`墨心` 提供**落墨引擎**（芥子园墨块 + 自由笔）。
- 用户要求：**文字要少**、**要有场景背景图**、**前后端方便更改**、借鉴博物馆水墨展陈（REA）。
- 线上：`https://kleinblue-dev.github.io/ink-museum/`（GitHub Pages，静态前台；后端本地/自托管可跑）。
- 前身：<https://kleinblue-dev.github.io/mojian/> · <https://kleinblue-dev.github.io/ink-mind/>（保持在线，不修改）。

### 文字纪律（硬）
- 每个页面可见中文 ≤ 90 字（展签、按钮、标签都算；`about` 浮层除外）。
- 一屏只允许一个标题 + 至多一行正文；按钮 2–4 字。
- 不写"疗愈/治疗/缓解/改善+疾病"字样；统一口径：`一段与自己的相处 · 不是医疗建议`。
- 不出现"评分/诊断/你很棒"式评价；不解释用户画作含义。

---

## 1. 目录与写作用域（先看这个再动手）

```
ink-museum/
├─ index.html                  # 应用壳（frontend 所有）
├─ css/                        # frontend 所有
├─ js/                         # frontend 所有，除 js/ink/**
│  ├─ main.js  state.js  ui.js  journey.js  scenes.js  api.js  gallery.js  export.js  audio.js
│  └─ ink/                     # ink-engine 所有
├─ content/content.js          # Lead 唯一所有（所有文案/场景/参数）
├─ data/masks.json             # 芥子园墨块数据（ink-engine 只读，Lead 生成）
├─ assets/bg/ assets/icons/ assets/paper-tile.webp   # curator 所有
├─ scripts/assets/             # curator 所有
├─ scripts/{build-standalone,validate-content}.mjs scripts/deploy-pages.ps1   # Lead
├─ server/**                   # backend 所有
├─ tests/e2e/**                # qa 所有
├─ tests/unit/                 # 各 owner 放自己的单测（文件名带模块前缀）
├─ docs/                       # SPEC=Lead；API.md=backend；QA_REPORT.md=qa；REA_MUSEUM.md=Lead
├─ CREDITS.md                  # curator
├─ package.json README.md robots.txt .nojekyll .gitignore manifest.webmanifest   # Lead
```

**规矩**：只写自己作用域内的文件；不 `git commit/push`（Lead 统一发布）；不删别人的文件；跨域改动先给 Lead 发消息。所有页面文案从 `content/content.js` 取，禁止散落硬编码中文（极小的 aria-label 也走 content）。

---

## 2. 页面动线（状态机）

```
enter → pre → scene → line → ink → post → reveal
                                          ↘ gallery / about（浮层，任意页可开）
```

| step | 名称（展签） | 内容（文字极少） | 出口 |
|---|---|---|---|
| `enter` | 入馆 | 标题「墨馆」+ 一行副题 + 「入馆」；角上：馆藏 · 关于 · 声（可选） | pre |
| `pre` | 来时 | 三个一行滑杆：**紧 / 累 / 乱**（1–7，必须都碰过） | scene |
| `scene` | 择境 | 四张画卡（背景缩略图 + 2 字厅名 + 小展签） | line |
| `line` | 一句 | 选中画作全屏；一句短句淡入；点「看一看 / 待一会儿 / 不语」→ 承接第二句 → 「落墨」 | ink |
| `ink` | 落墨 | 画作全屏 + 透明画布；底部极简工具条：笔 / 墨块、墨色、大小、撤销、重来、收笔 | post |
| `post` | 此刻 | 同三滑杆 + 一个问题「此刻，像什么？」四选一（静/松/远/空） | reveal |
| `reveal` | 收卷 | 合成画卷预览 + 三个小墨点的前后变化 + 一句承接 + 存馆藏 / 带走 / 再走一厅 | gallery |
| `gallery` | 馆藏墙 | 馆藏卡片网格（服务端优先，本机兜底）；空态一行字 | 关闭回原页 |
| `about` | 关于 | 说明/隐私/免责/出处/版本/两个前身链接（唯一允许长文字） | 关闭 |

- 每步切换：`900–1400ms` 水墨淡入淡出；`prefers-reduced-motion` 时 0ms 直切。
- 刷新恢复：session 存 `localStorage['ink-museum.session.v1']`，恢复到 `step`（`ink` 之后的墨迹不恢复，提示「墨已干」）。`?fresh=1` 清空重开。
- 返回：除 `enter` 外只允许回退一步（`reveal` 之后锁定，展示数据不可改）。
- 深链：`#gallery`、`#about` 可直接打开浮层。

### 状态对象（localStorage + POST 同构）
```js
{
  schemaVersion: '1.0.0',
  clientId: 'im_<随机16位>',        // 本机匿名 ID，无 PII
  startedAt: 'ISO',  finishedAt: 'ISO|null',
  step: 'enter|pre|scene|line|ink|post|reveal',
  sceneId: 'spring|water|bamboo|pavilion|null',
  pre:  { tight: 1..7|null, tired: .., scattered: .. },
  post: { tight: .., tired: .., scattered: .., mood: 'quiet|loose|far|empty|null' },
  line: { answer: 'look|stay|silent|null', round: 0|1 },
  ink:  { strokes: int, stamps: int, ms: int },   // 只统计，不存图像
  flags:{ sound: false }
}
```
- 不收集：姓名/手机号等身份信息；服务端只存匿名 `clientId` + 上表 + 画卷图。
- 本地草稿：每步变化即 `persist()`（try/catch 忽略配额错误）。
- `clearAll()`：清 session + 本机馆藏 + service worker caches（about 里「清空本机记录」）。

---

## 3. 内容模块契约 `content/content.js`（Lead 所有）

ESM，默认导出对象（**改一处前台+后端同时生效**）：

```js
export const CONTENT = {
  version: '1.0.0',
  museum: { title:'墨馆', subtitle:'一馆山水，一卷自己。', enter:'入馆',
            museumLabel:'馆藏', aboutLabel:'关于', soundOn:'声 · 开', soundOff:'声 · 关' },
  ethics: { short:'一段与自己的相处 · 不是医疗建议',
            long:'…（about 用，≤200 字）', privacy:'…', credits:'…' },
  pre:  { sign:'来时', hint:'三点都碰一下', items:[{key:'tight',label:'紧'},{key:'tired',label:'累'},{key:'scattered',label:'乱'}],
          ends:['不','很'], next:'往里走' },
  post: { sign:'此刻', hint:'再看一眼', moodLabel:'此刻，像什么？',
          moods:[{key:'quiet',label:'静'},{key:'loose',label:'松'},{key:'far',label:'远'},{key:'empty',label:'空'}],
          next:'收卷' },
  scenes: [ {
      id:'spring', name:'早春',
      work:{ title:'早春图', artist:'郭熙', dynasty:'北宋' },
      bg:{ wide:'assets/bg/spring-wide.webp', tall:'assets/bg/spring-tall.webp',
           thumb:'assets/bg/spring-thumb.webp', position:'50% 42%' },
      opening:['山还在长，不必现在就好。'],
      replies:[{key:'look',label:'看一看'},{key:'stay',label:'待一会儿'},{key:'silent',label:'不语'}],
      closing:['坐一会儿就好。'],
      ink: { palette:['#26221c','#5a4d3c','#9e3b2e'], defaultColor:0 }
    } /* water 静水/马远, bamboo 疏竹/文同, pavilion 空亭/倪瓒 */
  ],
  scroll: { seal:'墨馆', footer:'二〇二六 · kleinblue-dev', notSaved:'还没存进馆藏',
            save:'存进馆藏', saved:'已存进馆藏', saveLocal:'已存本机馆藏',
            download:'带走画卷', again:'再走一厅', hint:'长按或右键可保存图片' },
  gallery:{ title:'馆藏', empty:'还没有人留下画卷。', localTag:'本机', remoteTag:'馆藏', close:'合上' },
  about:{ title:'关于', close:'合上', version:'v1.0.0' },
  feedback:{ better:['松了一点。'], same:['还是那样，也没关系。'], worse:['今天不松，也可以。'] },
  ui: { back:'返回', undo:'撤销', clear:'重来', brush:'笔', stamp:'墨块', finish:'收笔',
        tone:['淡','中','浓'], size:'大小', rotate:'转', noInk:'也可以不落墨' }
};
export default CONTENT;
```
> 允许增加字段；删除/改名必须同步改 SPEC 并通知全员。

---

## 4. 落墨引擎契约 `js/ink/engine.js`（ink-engine 所有）

```js
export function createInkEngine(opts) → engine
opts = { canvas, masksUrl='data/masks.json', palette:[hex...], defaultColor=0,
         onFirstStroke?, onChange?({strokes,stamps}), interactive=true }
engine.setTool('brush'|'stamp')
engine.setTone('light'|'medium'|'dark')
engine.setColor(i)
engine.setSize(0.5..2)
engine.setRotation(deg)
engine.setStamp(id)
engine.undo(); engine.clear(); engine.hasInk()
engine.stats() → { strokes, stamps, ms, inkCoverage }
engine.toDataURL('image/png')                  // 透明叠层
engine.setInteractive(bool); engine.resize(); engine.destroy()
```
- 画布透明、`devicePixelRatio` 适配；`touch-action:none`；笔与墨块都能撤销（历史栈 ≥ 50）。
- 墨块数据：`data/masks.json` = ink-mind `maskData` 原样（11 块：水纹/土坡/柳/茅屋/花架/煎茶/洗盏/抱膝/洗药/垂钓/扳罾，`g` 0/1/2 = 远/中/点缀）。
- 参照实现：`_recon/ink-mind/index.html`（renderPiece/renderPieceMask/buildRibs/SPECS/hitTest/rotate/commit/undo）+ `_recon/mojian/index.html`（自由笔 settleDab/spawnBloom）。**只搬算法，不搬 UI 文案。**
- 性能预算：首帧可交互 < 1.2s；落笔响应 < 50ms；内存 < 120MB。
- 自测页：`tests/ink-demo.html`（ink-engine 自建自测）。

## 5. 前台模块边界（frontend 所有，除 js/ink/**）

- `main.js`：boot → 读 content → 检测 api.mode → 渲染当前 step + 全局浮层/键盘/URL hash。
- `state.js`：状态对象、`persist/resume/clearAll`、步骤迁移守卫。
- `journey.js`：各 step 的 DOM 渲染与事件（用 content）。
- `scenes.js`：背景图 art-direction（`<picture>` wide/tall）、预加载、淡入淡出、场景选择。
- `api.js`：`mode: 'server'|'local'`；启动 `GET /api/health` 800ms 超时判定；`saveScroll(payload)`、`listScrolls()`、`getContent()` 失败静默降级 local。
- `gallery.js`：馆藏墙渲染（server + local 合并）、卡片弹层。
- `export.js`：`composeScroll({bgImg, inkCanvas, scene, state})` → Blob/PNG（当前画布比例 ×2，纸边 + 落款印章 + 展签 + 日期）；不引入外部字体/图片。
- `ui.js`：toast、focus 管理、`prefers-reduced-motion`、按键（Esc 关浮层）。
- `audio.js`（P2，可后置）：WebAudio 程序化环境声（无音频文件），默认关。
- 无构建步骤：原生 ES module + CSS；运行时**零外部请求**（只用本站资源）。

## 6. 后端契约 `server/**`（backend 所有）

- 零依赖 Node ≥ 22，`node server/index.mjs` → `http://127.0.0.1:8790`（同端口静态托管前台 + API）。
- `PORT`/`HOST`/`DATA_DIR`/`PUBLIC_DIR` 环境变量；`--no-static` 可只跑 API。
- API：
  - `GET  /api/health` → `{ok:true, version, mode}`
  - `GET  /api/content` → content 对象（import `../content/content.js`）
  - `GET  /api/scrolls?limit=24&scene=&cursor=` → `{items:[{id,sceneId,mood,createdAt,imageUrl,thumbUrl,clientIdHash}], total}`
  - `POST /api/scrolls`（JSON，`Idempotency-Key` 头必填）body：`{schemaVersion, clientId, sceneId, pre, post, ink:{strokes,stamps,ms}, image:'data:image/webp;base64,…', mood}` → 201 `{id, imageUrl, createdAt}`
  - `GET  /api/scrolls/:id`；`GET /api/scrolls/:id/image.{webp|png}`（扩展名跟随实际字节类型；前端用响应里的 imageUrl）；`GET /api/stats`
- 校验：sceneId ∈ content.scenes；image 解码后 ≤ 2.5MB 且 magic=WEBP/PNG（两型都收，URL 跟随实际类型）；limit ≤ 60；clientId 格式 `im_[a-z0-9]{8,32}`；**不接收任何文本字段**。
- 限流可调（默认 6 次/10 分钟保存、120 次/分钟读）：`SAVE_LIMIT_MAX` / `SAVE_LIMIT_WINDOW_MS` / `READ_LIMIT_MAX` / `READ_LIMIT_WINDOW_MS`，或本地联调 `RATE_LIMIT=off`（显式设置才关；生产默认不开）。
- 存储：`server/data/scrolls.jsonl`（append + fsync）+ `server/data/images/<id>.webp`；启动重建内存索引；`schemaVersion`/`contentVersion` 落盘；原子写临时文件后 rename。
- 限流：同 IP 6 次/10 分钟保存、120 次/分钟读；按 `x-forwarded-for` 仅当 `TRUST_PROXY=1`。
- 安全：CSP 仅本站、`X-Content-Type-Options`、`Referrer-Policy`、`Cache-Control`；路径穿越防护；错误不泄漏栈。
- 测试：`node --test server/tests/`，覆盖 content 校验/保存/幂等/gallery/限流/大小限制/静态托管，不得依赖外网。

## 7. 视觉与资产（curator 产出，frontend 消费）

- 六个背景（场景 id）：`entry`（入馆·富春山居图）、`spring`（早春·郭熙）、`water`（静水·马远水图）、`bamboo`（疏竹·文同墨竹）、`pavilion`（空亭·倪瓒容膝斋图）、`scroll`（收卷底·宣纸纹理，程序生成）。
- 每个场景：`assets/bg/<id>-wide.webp`（1600×900，≤220KB）、`<id>-tall.webp`（900×1440，≤180KB）、`<id>-thumb.webp`（640×420，≤60KB）；`scroll` 只有 wide/tall 纸纹。
- 统一调性：暖纸白平衡、近单色、深墨不糊、轻暗角、无边框无字无水印；**不在图上烧字**。
- 出处：Wikimedia Commons 公有领域（PD-old / PD-Art），`CREDITS.md` + `assets/CREDITS.json` 记录作品/作者/朝代/文件页/直链/许可证/处理动作。
- 图标：`assets/icons/icon-192.png`、`icon-512.png`（朱砂印章「墨」），`favicon.ico`（可选）。
- 纸纹：`assets/paper-tile.webp` 512×512 可平铺，≤40KB。

## 8. 验收门（QA 必跑，Lead 终验）

1. `node --test server/tests/` 全绿。
2. `node scripts/validate-content.mjs` 0 错误（schema、文件存在、字数纪律、违禁词）。
3. 浏览器 E2E（Chrome headless via playwright-core；本地/QA 起服务用 `SAVE_LIMIT_MAX=200 READ_LIMIT_MAX=2000 node server/index.mjs`）：桌面 1440×900 / 手机 390×844 / 320 宽：完整走完 enter→reveal；无 console error/pageerror；无横向溢出；画布能落笔且撤销生效；本机模式保存画卷；服务端模式保存后出现在馆藏墙；`#about` 打开关闭；刷新恢复步骤。
4. 运行时网络：除本站资源外 0 请求（拦截记录）。
5. 资产预算：首屏 ≤ 600KB；全站 ≤ 6MB。
6. 可访问性：按钮有可读名称；键盘可完成非绘画流程；`prefers-reduced-motion` 无长动效。
7. 移动端：320/375/430 无横向滚动；画布 touch 不打断页面滚动。
8. `node scripts/build-standalone.mjs` 生成 `dist/standalone.html`（内联全部），双击可用、控制台 0 错。
9. 文档：README（3 分钟改文案/换图/起服务/发布）、docs/API.md、docs/REA_MUSEUM.md、CREDITS.md、docs/QA_REPORT.md。

## 9. 部署

- 新公开仓库 `kleinblue-dev/ink-museum`；GitHub Pages 源 = `main` 分支 `/ (root)`（`.nojekyll`）。
- Lead 用 `scripts/deploy-pages.ps1` 发布并验证线上 URL；前台不依赖后端（local 模式）。
- 旧站保持在线；`about` 底部链回 mojian / ink-mind，标明「前身」。

## 10. 环境

- Windows 11 · Node v24.14 · Python `E:\AI\Python311\python.exe`（PIL 12.3 / numpy 2.4.6）· Chrome `C:\Program Files\Google\Chrome\Application\chrome.exe`。
- 下载外网资源走代理：`$env:HTTPS_PROXY='http://127.0.0.1:7897'`（仅构建期；运行时零外链）。
- 共享工作区：`C:\Users\samcz\Documents\deepseek-harness\default-workspace`；项目根 `ink-museum\`。
