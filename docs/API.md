# 墨馆后端 API（server/）

零依赖 Node（≥ 22，本机 v24）单进程后端：**同端口托管前台静态文件 + JSON API + 画像文件**。
契约源头：`docs/SPEC.md` §6；本文件是后端的实现说明与联调手册。

- 入口：`node server/index.mjs`（在 `ink-museum/` 下执行）
- 默认：`http://127.0.0.1:8790`
- 前台：同端口 `PUBLIC_DIR`（默认 = 项目根），与 API 共用 8790
- 依赖：**零 npm 依赖**，只用 `node:*` 内置模块
- 数据：默认 `server/data/`（已加入 `.gitignore`），`scrolls.jsonl` + `images/`

---

## 1. 快速启动

```bash
cd ink-museum
node server/index.mjs
# 浏览器打开 http://127.0.0.1:8790  →  前台
#                  http://127.0.0.1:8790/api/health  →  API
```

启动日志第一行是机器可读的就绪信号（QA / 部署脚本可匹配）：

```text
[ink-museum] listening on http://127.0.0.1:8790 mode=static+api
```

`mode` 取值：`static+api`（默认）或 `api`（`--no-static`）。

| 场景 | 命令 |
|---|---|
| 本地开发（默认） | `node server/index.mjs` |
| 只跑 API | `node server/index.mjs --no-static` |
| 换端口 / 主机 | `$env:PORT=0; $env:HOST='0.0.0.0'; node server/index.mjs` |
| 只服务前台静态文件（无 API） | 任意静态服务器指向项目根即可（前台会降级 local 模式） |
| 测试 | `node --test "server/tests/*.test.mjs"` |

优雅退出：`Ctrl+C`（SIGINT）或 SIGTERM，会先关闭连接、flush 写入，再退出。

---

## 2. 环境变量

全部可选。布尔值接受 `1/true/yes/on` 与 `0/false/no/off`。

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8790` | 监听端口；`0` = 随机可用端口（测试用） |
| `HOST` | `127.0.0.1` | 监听地址；对外服务用 `0.0.0.0` |
| `DATA_DIR` | `server/data` | 数据目录（`scrolls.jsonl` + `images/`），相对路径按 `process.cwd()` 解析 |
| `PUBLIC_DIR` | 项目根 | 静态文件根目录，相对路径按 `process.cwd()` 解析 |
| `TRUST_PROXY` | 关 | `1` 时才信任 `x-forwarded-for` 第一跳作为客户端 IP（反向代理后面开启） |
| `RATE_LIMIT` | 开 | `off` = 关闭保存/读限流（**仅本地/测试**，启动会打印警告） |
| `SAVE_LIMIT_MAX` | `6` | 保存限流：窗口内最多次数 |
| `SAVE_LIMIT_WINDOW_MS` | `600000` | 保存限流窗口（毫秒，默认 10 分钟） |
| `READ_LIMIT_MAX` | `120` | 读限流：窗口内最多次数 |
| `READ_LIMIT_WINDOW_MS` | `60000` | 读限流窗口（毫秒，默认 1 分钟） |

### 本地联调 / QA 用法（重要）

E2E 会从同一 IP 连续保存多次，默认「10 分钟 6 次」会互相打架。QA 起服务时放大或关闭限流：

```powershell
# 方式一：放大保存配额（推荐，保留限流路径）
$env:SAVE_LIMIT_MAX='200'
$env:SAVE_LIMIT_WINDOW_MS='600000'
node server/index.mjs

# 方式二：彻底关闭限流（仅本地/测试；启动日志会警告）
$env:RATE_LIMIT='off'
node server/index.mjs
```

bash 写法：`SAVE_LIMIT_MAX=200 SAVE_LIMIT_WINDOW_MS=600000 node server/index.mjs`
测试也可用 `node --test "server/tests/*.test.mjs"` 跑（内部全部 `PORT=0` + 临时目录，不占 8790、不依赖外网）。

---

## 3. 响应头与安全

**所有响应**（API、静态、404、错误）统一带以下头：

```http
Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()
```

- `CSP` 仅本站；图片允许 `data:`（画卷预览）；脚本只允许同源外部脚本（**前台不要用内联 `<script>`**，内联样式可用）。
- 静态路径：`decodeURIComponent` 后 `path.resolve` 再校验前缀，拒绝 `..%2f`、`..%5c`、NUL 等路径穿越（403/400）；再对真实路径做 `realpath` 越界校验（防符号链接跳出）。
- API 错误统一 JSON：`{ "error": { "code": "...", "message": "..." } }`，**不返回堆栈**；未预期异常只写服务端日志，客户端拿到 `500 internal_error`。
- 默认无 CORS 头（浏览器只能同源访问）；`/api` 只接受同源请求。
- 没有 Cookie / 会话 / 第三方请求。

---

## 4. 端点总表

| 方法 | 路径 | 限流桶 | 说明 |
|---|---|---|---|
| GET | `/api/health` | 豁免 | 健康检查（前端 800ms 超时探测） |
| GET | `/api/content` | 读 | 返回 `content/content.js` 完整对象 |
| GET | `/api/scrolls` | 读 | 馆藏列表（分页 + scene 过滤） |
| POST | `/api/scrolls` | 保存 | 保存一卷（需 `Idempotency-Key`） |
| GET | `/api/scrolls/:id` | 读 | 单卷详情（含量表/统计，不含原始 clientId） |
| GET | `/api/scrolls/:id/image.webp` | 读 | 画卷图片（WebP 记录；PNG 记录见下） |
| GET | `/api/scrolls/:id/image.png` | 读 | 画卷图片（仅 PNG 记录；扩展名与字节类型不一致 → 404） |
| GET | `/api/stats` | 读 | 馆藏统计 |

- 读限流桶覆盖：`/api/content`、`/api/scrolls*`（含图片）、`/api/stats`；`/api/health` 豁免（前端启动探测不能被限流误伤）。
- 所有 GET 端点支持 HEAD（同头，无 body）。
- 业务为**只增不删**：没有 DELETE / PATCH 端点。

### 4.1 `GET /api/health`

```json
{
  "ok": true,
  "version": "1.0.0",
  "mode": "server",
  "serverVersion": "1.0.0",
  "contentVersion": "1.0.0",
  "features": { "static": true, "rateLimit": true },
  "time": "2026-11-07T10:51:26.756Z"
}
```

- `version` = `content.version`；`mode` 恒为 `server`（前端据此从 local 切 server）。
- `features.static` / `features.rateLimit` 方便 QA/部署判断当前模式。

### 4.2 `GET /api/content`

直接返回 `content/content.js` 的默认导出对象（前台与后端共用同一份内容）。

```json
{ "version": "1.0.0", "museum": { "title": "墨馆", "...": "..." }, "scenes": [ ... ] }
```

`Cache-Control: no-cache`；改 `content/content.js` 后需重启后端生效（ESM import 一次性加载）。

### 4.3 `GET /api/scrolls?limit=24&scene=&cursor=`

| 参数 | 默认 | 说明 |
|---|---|---|
| `limit` | `24` | 1..60，超出按 60 截断；非正整数 → 400 |
| `scene` | 空 | 场景 id；**空 = 全部**；不在 `content.scenes` → 400 |
| `cursor` | 空 | 不透明游标，把上一页返回的 `nextCursor` 原样传回 |

```json
{
  "items": [
    {
      "id": "9af23b53-4fa2-4691-b56a-35cea1fd857d",
      "sceneId": "spring",
      "mood": "quiet",
      "createdAt": "2026-11-07T10:51:26.768Z",
      "imageUrl": "/api/scrolls/9af23b53-4fa2-4691-b56a-35cea1fd857d/image.webp",
      "thumbUrl": "/api/scrolls/9af23b53-4fa2-4691-b56a-35cea1fd857d/image.webp",
      "clientIdHash": "934f2ff543ff5dcf"
    }
  ],
  "total": 1,
  "nextCursor": null
}
```

- 排序：**保存时间倒序**（同毫秒按写入顺序倒序）。
- `total` = 过滤后的总数；`nextCursor` 为 `null` 表示没有下一页。
- `clientIdHash` = `sha256(clientId)` 前 16 位 hex，供前端标记「本机」；不返回原始 `clientId`。
- 零依赖后端不生成缩略图：`thumbUrl` 暂等于 `imageUrl`。

### 4.4 `POST /api/scrolls`

请求头：

```http
Content-Type: application/json
Idempotency-Key: <调用方生成的唯一键>
```

请求体（**只认白名单字段；顶层多余字段一律忽略、不落盘**）：

```json
{
  "schemaVersion": "1.0.0",
  "clientId": "im_ab12cd34ef56gh78",
  "sceneId": "spring",
  "pre":  { "tight": 3, "tired": 4, "scattered": 2 },
  "post": { "tight": 2, "tired": 3, "scattered": 1, "mood": "quiet" },
  "ink":  { "strokes": 12, "stamps": 2, "ms": 48000 },
  "mood": "quiet",
  "image": "data:image/webp;base64,UklGR…"
}
```

| 字段 | 规则 | 失败错误码 |
|---|---|---|
| `schemaVersion` | `MAJOR.MINOR.PATCH` 字符串，主版本必须 = `content.version` 主版本 | `invalid_schema_version` / `incompatible_schema_version` |
| `clientId` | `^im_[a-z0-9]{8,32}$`（本机匿名 ID，无 PII） | `invalid_client_id` |
| `sceneId` | ∈ `content.scenes[].id` | `invalid_scene` |
| `pre` | 对象，**只允许** `tight/tired/scattered`，三者必填，整数 1..7 | `invalid_pre` |
| `post` | 对象，**只允许** `tight/tired/scattered/mood`，三量表必填 1..7，`mood` 可选 | `invalid_post` |
| `mood` | ∈ `content.post.moods[].key`；也可只写在 `post.mood`（两处都写时必须一致） | `invalid_mood` / `missing_mood` / `mood_conflict` |
| `ink` | `{strokes,stamps,ms}` 三者必填，非负整数且 ≤ `600000`（10 分钟，能容纳 5–8 分钟动线的 `ms`，约 30–48 万）；多余键忽略 | `invalid_ink` |
| `image` | `data:image/(webp|png);base64,<base64>`；解码后 ≤ 2.5MB；magic 必须与声明类型一致 | `image_required` / `invalid_image` / `invalid_image_magic` / `image_too_large`(413) |
| body | JSON 对象，≤ 4MB | `invalid_body` / `invalid_json` / `payload_too_large`(413) / `unsupported_media_type`(415) |
| `Idempotency-Key` | 必填，1..200 字符 | `missing_idempotency_key` / `invalid_idempotency_key` |

**不做 UGC**：不接收、不存储、不回显任何自由文本（昵称/留言/标题等一律忽略，只落盘上表字段）。`ink` 上如 `inkCoverage` 等额外统计键会被忽略。

图片类型单一语义：**保存后 `imageUrl` 的扩展名 = 实际字节类型**——WebP 记录恒为 `/image.webp`（SPEC 正常路径），PNG 记录为 `/image.png`。前端请始终使用响应里的 `imageUrl`，不要手写扩展名；请求与实际类型不一致的扩展名 → 404。

成功响应（首次）：

```http
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
```

```json
{
  "id": "9af23b53-4fa2-4691-b56a-35cea1fd857d",
  "imageUrl": "/api/scrolls/9af23b53-4fa2-4691-b56a-35cea1fd857d/image.webp",
  "thumbUrl": "/api/scrolls/9af23b53-4fa2-4691-b56a-35cea1fd857d/image.webp",
  "createdAt": "2026-11-07T10:51:26.768Z",
  "sceneId": "spring",
  "mood": "quiet"
}
```

#### 幂等（重放）

同一个 `Idempotency-Key` + 同一份内容，重放**不重复落盘**，返回第一次的记录：

- 首次：`201` + 记录
- 重放：`200` + 同一 `{id, imageUrl, createdAt, …}`，并带响应头 `Idempotent-Replay: true`
- 同 key 但内容不同：`409 idempotency_conflict`
- 并发同 key 请求会合流（只写一条）；幂等索引会随 `scrolls.jsonl` 在启动时重建，**跨重启仍生效**

> 前端重试网络失败时，必须用**同一个** `Idempotency-Key`，否则会产生两条不同画卷。

### 4.5 `GET /api/scrolls/:id`

在列表公开字段之外，附带量表、墨迹统计与版本信息（用于详情/弹层）：

```json
{
  "id": "…",
  "sceneId": "spring",
  "mood": "quiet",
  "createdAt": "2026-11-07T10:51:26.768Z",
  "imageUrl": "/api/scrolls/…/image.webp",
  "thumbUrl": "/api/scrolls/…/image.webp",
  "clientIdHash": "934f2ff543ff5dcf",
  "schemaVersion": "1.0.0",
  "contentVersion": "1.0.0",
  "pre":  { "tight": 3, "tired": 4, "scattered": 2 },
  "post": { "tight": 2, "tired": 3, "scattered": 1, "mood": "quiet" },
  "ink":  { "strokes": 12, "stamps": 2, "ms": 48000 }
}
```

不存在 / id 非法 → `404 scroll_not_found`（不区分「格式错」与「不存在」，避免探测）。

### 4.6 `GET /api/scrolls/:id/image.webp`（或 `.png`）

- `Content-Type`：`image/webp` 或 `image/png`（与记录实际字节一致）
- `Cache-Control: public, max-age=3600`；带 `ETag`（图片 sha256 前 32 位），支持 `If-None-Match` → `304`
- 也支持 `HEAD`
- 记录存在但图片文件缺失 → `404 image_not_found`

### 4.7 `GET /api/stats`

```json
{
  "total": 12,
  "byScene": { "spring": 4, "water": 3, "bamboo": 3, "pavilion": 2 },
  "byMood":  { "quiet": 5, "loose": 4, "far": 2, "empty": 1 },
  "firstCreatedAt": "2026-11-07T10:51:26.768Z",
  "lastCreatedAt":  "2026-11-07T12:03:11.002Z",
  "badLines": 0,
  "contentVersion": "1.0.0",
  "generatedAt": "2026-11-07T12:03:12.000Z"
}
```

`badLines` = 启动重建索引时跳过（并计数）的坏行数，正常为 0。

---

## 5. 错误码表

所有错误体统一为 `{ "error": { "code": string, "message": string } }`。

| HTTP | `code` | 触发场景 |
|---|---|---|
| 400 | `bad_request` | URL 无法解析 |
| 400 | `invalid_body` | body 非 JSON 对象 / 为空 |
| 400 | `invalid_json` | body 不是合法 JSON |
| 400 | `missing_idempotency_key` | 缺少 `Idempotency-Key` |
| 400 | `invalid_idempotency_key` | key 为空 / 超过 200 字符 |
| 400 | `invalid_schema_version` | 缺失或不是 `MAJOR.MINOR.PATCH` |
| 400 | `incompatible_schema_version` | 主版本与 `content.version` 不一致 |
| 400 | `invalid_client_id` | 不匹配 `^im_[a-z0-9]{8,32}$` |
| 400 | `invalid_scene` | `sceneId`/`?scene` 不在 `content.scenes` |
| 400 | `invalid_pre` | `pre` 非对象 / 缺键 / 值非 1..7 整数 / 未知键 |
| 400 | `invalid_post` | `post` 同上（允许 `mood`） |
| 400 | `invalid_mood` / `missing_mood` / `mood_conflict` | `mood` 不合法 / 缺失 / 两处不一致 |
| 400 | `invalid_ink` | `ink.*` 非 0..600000 整数 |
| 400 | `image_required` | 缺少 `image` |
| 400 | `invalid_image` | 非 `data:image/(webp|png);base64,…` / base64 非法 |
| 400 | `invalid_image_magic` | 字节 magic 与声明类型不符 |
| 400 | `invalid_limit` / `invalid_cursor` | 列表参数非法 |
| 400 | `bad_path` | 路径编码非法 / 含 NUL |
| 403 | `forbidden` | 静态路径越界（路径穿越） |
| 404 | `not_found` | 未知 `/api/*` 路径 |
| 404 | `scroll_not_found` | 画卷不存在 |
| 404 | `image_not_found` | 图片不存在 / 扩展名与类型不一致 |
| 404 | `static_disabled` | `--no-static` 下请求静态路径 |
| 405 | `method_not_allowed` | 方法不支持（含 `Allow` 头） |
| 409 | `idempotency_conflict` | 同 key 不同内容 |
| 413 | `payload_too_large` | 请求体 > 4MB |
| 413 | `image_too_large` | 图片解码后 > 2.5MB |
| 415 | `unsupported_media_type` | 非 `application/json` |
| 429 | `rate_limited` | 触发限流（带 `Retry-After` 秒数） |
| 500 | `internal_error` | 未预期异常（详情只进服务端日志） |

示例：

```json
{ "error": { "code": "invalid_scene", "message": "sceneId 不在 content.scenes 中" } }
```

---

## 6. 限流

单进程内存滑动窗口，按客户端 IP 分桶：

| 桶 | 默认 | 覆盖端点 | 环境变量 |
|---|---|---|---|
| 保存 | 6 次 / 10 分钟 | `POST /api/scrolls` | `SAVE_LIMIT_MAX` / `SAVE_LIMIT_WINDOW_MS` |
| 读 | 120 次 / 分钟 | `/api/content`、`/api/scrolls*`（含图片）、`/api/stats` | `READ_LIMIT_MAX` / `READ_LIMIT_WINDOW_MS` |

- 客户端 IP：默认取 socket 地址；**仅 `TRUST_PROXY=1`** 时取 `x-forwarded-for` 第一跳（反代后必须开启，否则所有用户共用一个桶）。
- 超限：`429` + `{ "error": { "code": "rate_limited" } }` + `Retry-After: <秒>`（至少 1）。
- **计的是尝试次数**：POST 即使校验失败也消耗保存配额（防刷）；读限流对所有读端点共享同一桶。
- `/api/health` 不参与读限流。
- `RATE_LIMIT=off` 关闭两个桶（本地/测试用，生产别开）。
- 重启清零、单实例有效；多实例部署需要外部存储（当前未实现）。

---

## 7. 存储结构

默认 `server/data/`（`.gitignore` 已忽略）：

```text
server/data/
├─ scrolls.jsonl      # 每行一条画卷记录（append-only，含 fsync）
└─ images/
   ├─ <id>.webp       # WebP 画卷（正常路径）
   └─ <id>.png        # PNG 画卷（若上传 PNG）
```

`scrolls.jsonl` 单行示例（UTF-8，一行一个 JSON）：

```json
{"v":1,"id":"9af23b53-4fa2-4691-b56a-35cea1fd857d","schemaVersion":"1.0.0","contentVersion":"1.0.0","serverVersion":"1.0.0","clientId":"im_ab12cd34ef56gh78","clientIdHash":"934f2ff543ff5dcf","sceneId":"spring","mood":"quiet","pre":{"tight":3,"tired":4,"scattered":2},"post":{"tight":2,"tired":3,"scattered":1,"mood":"quiet"},"ink":{"strokes":12,"stamps":2,"ms":48000},"image":{"file":"<id>.webp","type":"webp","mime":"image/webp","bytes":12345,"sha256":"…"},"idemHash":"…","payloadHash":"…","createdAt":"2026-11-07T10:51:26.768Z"}
```

| 字段 | 说明 |
|---|---|
| `v` | 记录格式版本（当前 1） |
| `id` | `crypto.randomUUID()`（不可猜测、碰撞可忽略） |
| `schemaVersion` / `contentVersion` | 落盘的契约版本与内容版本 |
| `serverVersion` | 后端版本 |
| `clientId` | 匿名本机 ID（`im_…`，无 PII）；**API 只返回哈希，不返回原值** |
| `clientIdHash` | `sha256(clientId)` 前 16 位 hex，供前端标记「本机」 |
| `pre` / `post` / `ink` / `mood` / `sceneId` | 见 §4.4 |
| `image` | `file`（相对 images/ 的文件名）、`type`、`mime`、`bytes`、`sha256` |
| `idemHash` | `sha256("idem:"+Idempotency-Key)`（不存原始 key） |
| `payloadHash` | 规范化载荷指纹（含图片 sha256），用于重放一致性判断 |
| `createdAt` | 服务端时间 ISO 8601 |

写入语义：

1. **图片先原子写**：临时文件 → `fsync` → `rename` 成 `<id>.<ext>`；
2. 再向 `scrolls.jsonl` **append 一行并 `fsync`**；append 失败会回滚删除图片；
3. 进程崩溃可能留下**孤儿图片**（未入 jsonl，不会被索引/服务），可安全手动清理；
4. 启动时逐行重建内存索引：坏行（非法 JSON / 缺字段 / id 重复）跳过并计数（`/api/stats.badLines` + 启动日志）；若文件末尾是崩溃留下的**无换行半行**，启动会补一个换行，后续 append 不会粘连；
5. 幂等索引（`idemHash → id`）同样在启动时重建。

备份 = 备份整个 `server/data/`（jsonl + images 一致性以 jsonl 为准）。

---

## 8. 隐私边界

- **匿名**：只存前端本机生成的匿名 `clientId`（`im_…`）与上表数据；**不收集**姓名、手机号、邮箱、IP、User-Agent 等任何身份信息（IP 仅用于内存限流，不落盘、不返回）。
- **无文本 UGC**：后端不接收任何自由文本字段；顶层多余字段直接忽略、不落盘。前台「关于/隐私」文案由 `content/content.js` 提供，不经过后端。
- **不收集行为轨迹**：没有埋点、没有 Cookie、没有第三方请求（CSP 也限制外链）。
- API 不返回原始 `clientId`（只给 `clientIdHash`）；`scrolls.jsonl` 里保存原始 `clientId` 是 SPEC §2 的匿名标识，无 PII。
- 图片为匿名画卷；`about` 中「清空本机记录」只清前端 localStorage，不会删除服务端馆藏（馆藏 append-only，无删除接口）。
- 日志不打印请求体 / 图片内容。

---

## 9. 部署

### 本地 / 内网

```bash
node server/index.mjs        # 前台 + API 都在 http://127.0.0.1:8790
```

### 自托管（生产，单实例）

1. `DATA_DIR=/var/lib/ink-museum/data`，`PUBLIC_DIR=/srv/ink-museum/public`（**只放前台文件**，不要指向整个项目根，避免把 docs/ 等暴露出去）；
2. `HOST=0.0.0.0 PORT=8790`；
3. 前面放 Caddy/nginx 做 HTTPS 与反向代理，并设 **`TRUST_PROXY=1`**（否则限流会把所有用户当同一个 IP）；
4. 保持默认限流开启；`RATE_LIMIT=off` 仅限本地/测试；
5. 单进程写文件即可满足小馆流量；多实例/水平扩展需要把存储与限流换成外部服务（当前未实现）；
6. 定期备份 `DATA_DIR`；升级重启会重建索引，无需迁移。

systemd 单元示例：

```ini
[Unit]
Description=ink-museum backend
After=network.target

[Service]
WorkingDirectory=/srv/ink-museum
Environment=HOST=0.0.0.0 PORT=8790 DATA_DIR=/var/lib/ink-museum/data PUBLIC_DIR=/srv/ink-museum/public TRUST_PROXY=1
ExecStart=/usr/bin/node server/index.mjs
Restart=on-failure
User=inkmuseum

[Install]
WantedBy=multi-user.target
```

Caddy 反代示例（自动 HTTPS）：

```caddyfile
museum.example.com {
  reverse_proxy 127.0.0.1:8790
}
```

### GitHub Pages（纯静态）

线上 Pages 没有后端，前台自动降级 `local` 模式（馆藏只在本机 localStorage）；本后端仅用于本地/自托管联调。前台静态部署不需要改任何后端配置。

---

## 10. 与 SPEC 的偏差 / 已知限制

1. **图片扩展名跟随实际类型（已与 Lead 同步，SPEC §6 按 B 语义更新）**：WebP 上传 → 恒为 `/api/scrolls/:id/image.webp`（SPEC 正常路径）；PNG 上传 → `/image.png`。前端始终使用响应中的 `imageUrl`，不要写死扩展名；扩展名与类型不一致的 URL 返回 404。
2. `thumbUrl` 暂等于 `imageUrl`：零依赖后端不做图片缩放，馆藏墙直接加载原图（≤2.5MB/张，本地自托管可接受；流量大时建议构建期生成缩略图或加图片处理服务）。
3. `ink` 三字段（含 `ms`）上限 **600000**（10 分钟）：5–8 分钟动线的 `ms` 约 30–48 万，可正常保存；`strokes`/`stamps` 沿用同一上限（实际远达不到）。SPEC §6 未写死该数值，已由 Lead 确认为 600000；如需再调，改 `server/config.mjs` 的 `DEFAULTS.maxInkValue`。
4. 列表 `total` 为**过滤后**总数；`cursor` 是基于 offset 的不透明游标（馆藏只增不删，顺序稳定）。
5. 限流为**单进程内存**实现：重启清零、多实例不共享。
6. 无 CORS、无鉴权、无删除/修改接口（有意为之：匿名、只增、馆藏由本机决定上传）。
7. 静态托管默认公开 `PUBLIC_DIR` 下所有文件（开发期 = 项目根，会暴露 `docs/`、`content/` 等只读文件）；生产请按 §9 指向仅含前台产物的目录。
8. CSP `script-src 'self'`：前台不能使用内联 `<script>`（内联样式允许）；若构建产物需要内联脚本，需要同步调整 CSP。

---

## 11. 测试

```bash
cd ink-museum
node --test "server/tests/*.test.mjs"   # 后端全套（node:test，零依赖）
npm test                                 # 后端 + tests/unit（仓库脚本）
```

覆盖：`health` / `content` / 合法保存 / 幂等重放与并发合流 / 幂等跨重启 / 各类非法载荷（scene、schema、clientId、pre/post/ink、图片 magic、超大图、超大 body）/ 列表分页与 scene 过滤 / 详情与图片获取及 Content-Type / 限流（保存、读、env 覆盖、`RATE_LIMIT=off`、`TRUST_PROXY`）/ 静态托管 MIME、缓存、CSP、404、路径穿越、`--no-static` / 存储重建索引与坏行计数 / CLI 入口（真实 spawn，`PORT=0`）。

测试**不依赖外网**，全部使用临时 `DATA_DIR`/`PUBLIC_DIR` + 随机端口（`PORT=0`），可与正在跑的 8790 开发服务器并存。