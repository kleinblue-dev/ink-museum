# 墨馆 ink-museum · QA 验收报告

> 独立验收人：qa-verifier（不引用开发者自测结论，全部证据为本机复跑）
> SPEC 版本：1.0.0 · SPEC §8 九条验收门
> 状态：**静态门已验收（PASS）；E2E 待 v1.1「墨块托盘」交付后补跑**（2026-11-07 19:18 快照）
> 最终结论：见文末「总结论」，E2E 完成后更新。

---

## 0. 结论摘要（截至静态验收）

| 项目 | 结果 | 证据 |
|---|---|---|
| `npm test`（后端 + 前台/引擎单测） | **PASS**：93 tests / 93 pass / 0 fail | `_qa-artifacts/final-static/npm-test.log` |
| `node scripts/validate-content.mjs` | **PASS**：0 error / 0 warn | `_qa-artifacts/final-static/validate-content.log` |
| `node scripts/check-encoding.mjs` | **PASS**（1 WARN：`scripts/_probe-live.mjs` 带 BOM，非运行时产品文件） | `_qa-artifacts/final-static/check-encoding.log` |
| `node scripts/build-standalone.mjs` | **PASS**：`dist/standalone.html` 3,283,200 B（3.13MB），模块 10 / 内联资源 14 / 掩膜 11 | `_qa-artifacts/final-static/build-standalone.log` |
| 资产预算（首屏 / 图片 / 全站） | **PASS**：首屏 407.1KB（≤600KB）、图片 2.33MB（≤6MB）、全站 2.85MB / 39 文件（≤6MB） | `_qa-artifacts/final-static/static-check.json` |
| 文档齐全 | **PASS**（README / SPEC / API / REA_MUSEUM / CREDITS 均在；QA_REPORT 即本文件） | 同上 JSON `docs` 字段 |
| E2E（§8 门 3/4/6/7 + standalone 运行） | **待跑**：等 v1.1 交付，full suite 代码已就绪 | — |

静态验收快照：2026-11-07 19:18（v1.1 增量写入中，`js/journey.js`/`css/steps.css` 正在变更；最终以 E2E 运行时的 `result.json.projectSnapshot` 哈希为准）。

---

## 1. SPEC §8 九条验收门状态

| # | 验收门 | 状态 | 证据 / 说明 |
|---|---|---|---|
| 1 | `npm test` 全绿 | ✅ PASS | 93/93 pass，0 fail（`final-static/npm-test.log`） |
| 2 | `validate-content.mjs` 0 错误 | ✅ PASS | 0 error / 0 warn（`final-static/validate-content.log`） |
| 3 | 浏览器 E2E（三视口全流程/落墨撤销/保存/馆藏/about/刷新恢复） | ⏳ 待跑 | `node tests/e2e/run.mjs --suite=full`；v1.1 交付后执行 |
| 4 | 运行时零外链 | ⏳ 待跑 | 首屏静态测量已确认 external=0，全流程待 E2E |
| 5 | 资产预算首屏 ≤600KB / 全站 ≤6MB | ✅ PASS | 首屏 407.1KB；全站 2.85MB；图片 2.33MB（`final-static/static-check.json`） |
| 6 | 可访问性（按钮名称/键盘/reduced-motion） | ⏳ 待跑 | full suite `a11y.*` |
| 7 | 移动端 320/375/430 无横向滚动 + 画布 touch 不滚动 | ⏳ 待跑 | full suite `mobile.*` |
| 8 | `dist/standalone.html` 生成、双击可用、控制台 0 错 | 构建 ✅ / 运行 ⏳ | 构建 3.13MB；file:// 运行验证待 E2E |
| 9 | 文档齐全 | ✅ PASS | 6 份文档均存在非空（本文件即 QA_REPORT） |

---

## 2. 静态验收明细

### 2.1 单测（§8 门 1）

```
ℹ tests 93
ℹ pass 93
ℹ fail 0
```

复现：`cd ink-museum; npm test`（`package.json` scripts.test = `node --test "server/tests/*.test.mjs" "tests/unit/*.test.mjs"`）

### 2.2 内容校验（§8 门 2）

`node scripts/validate-content.mjs` → `PASS 0 error / 0 warn`，各类资产尺寸/KB 列表见日志。

### 2.3 编码检查（Lead 追加项）

`node scripts/check-encoding.mjs` → 扫描 59 个文本文件，PASS；1 条 WARN：
- `scripts/_probe-live.mjs` 带 UTF-8 BOM（Lead 的 live 探针脚本，非产品运行时文件，不影响运行时；建议后续修掉）。

### 2.4 资产预算（§8 门 5）

| 指标 | 实际值 | 阈值 | 结论 |
|---|---|---|---|
| 首屏 entry 传输（到 load 为止，本地静态） | **416,846 B ≈ 407.1KB** | ≤600KB | ✅ |
| 首屏资源数 | 22 个（top：entry-wide 192.6KB / engine 54KB / journey 51.9KB / steps.css 22.4KB） | — | — |
| 图片总量（`assets/bg` + icons + paper） | **2,440,327 B ≈ 2.33MB** | ≤6MB | ✅ |
| 全站运行时资源（assets+js+css+content+data+index+manifest+robots） | **2,992,150 B ≈ 2.85MB / 39 文件** | ≤6MB | ✅ |
| standalone 单文件 | 3,283,200 B ≈ 3.13MB | 报告项 | — |

首屏测量时 console error=0、外站请求=0、requestfailed=0（`static-check.json.firstScreenDiagnostics`）。

### 2.5 standalone 构建（§8 门 8 的构建部分）

`node scripts/build-standalone.mjs` → `standalone.html 生成：dist\standalone.html 3206KB 模块 10 个 / 内联资源 14 处 / 掩膜 11 块`，exit 0。
file:// 双击运行验证（Chrome headless、0 console error、能走 enter→reveal、无未内联引用）待 E2E。

### 2.6 文档（§8 门 9）

| 文档 | 大小 | 存在 |
|---|---|---|
| README.md | 6,500 B | ✅ |
| docs/SPEC.md | 15,684 B | ✅ |
| docs/API.md | 22,703 B | ✅ |
| docs/REA_MUSEUM.md | 7,202 B | ✅ |
| CREDITS.md | 8,510 B | ✅ |
| docs/QA_REPORT.md | 本文件 | ✅ |

---

## 3. E2E 验收（待 v1.1 后填写）

计划与门映射见 `tests/e2e/README.md`「Full suite 计划」。本次将执行：

```powershell
cd ink-museum
node tests/e2e/run.mjs --suite=full
```

- server 模式：8793 端口自 spawn `server/index.mjs`（临时 DATA_DIR + `SAVE_LIMIT_MAX=200`/`READ_LIMIT_MAX=100000`），跑完按 PID 关。
- local 模式：8794 端口自 spawn `scripts/serve-static.mjs`，验证本机保存/馆藏。
- standalone：`dist/standalone.html` 用 `file://` 打开验证。
- 产物：`_qa-artifacts/final/`（截图 + result.json + 服务日志）。

### 3.1 待填：E2E 结果总表

<!-- E2E-RESULTS -->

### 3.2 待填：失败项与阻塞项

<!-- E2E-FAILURES -->

---

## 4. 证据清单

| 类别 | 路径 |
|---|---|
| 单测日志 | `_qa-artifacts/final-static/npm-test.log` |
| 内容校验日志 | `_qa-artifacts/final-static/validate-content.log` |
| 编码检查日志 | `_qa-artifacts/final-static/check-encoding.log` |
| standalone 构建日志 | `_qa-artifacts/final-static/build-standalone.log` |
| 静态验收 JSON（预算/文档/首屏明细） | `_qa-artifacts/final-static/static-check.json` |
| E2E 结果（待生成） | `_qa-artifacts/final/result.json` + 截图 + `server-mode.log` / `local-static.log` |

## 5. 复现命令

```powershell
cd ink-museum
npm test
node scripts/validate-content.mjs
node scripts/check-encoding.mjs
node scripts/build-standalone.mjs
node tests/e2e/static-check.mjs        # 资产预算/文档/首屏（自起 8794 静态服务）
node tests/e2e/run.mjs --suite=full    # E2E（v1.1 后）
```

## 6. 观察项 / 备注（不影响当前结论）

1. `scripts/_probe-live.mjs` UTF-8 BOM：建议清理（不在运行时路径）。
2. v1.1「墨块托盘」增量交付前，本报告静态数字基于 2026-11-07 19:18 快照；E2E 跑完后补最终哈希。
3. 线上基线（Lead 独立探针：桌面全流程 console error 0 / 外链 0）仅作对照，不作为本报告证据。

---

## 总结论

**静态门（§8 #1/#2/#5/#9 + #8 构建）全部 PASS；E2E 门（#3/#4/#6/#7 + #8 运行）待 v1.1 交付后补跑并更新「总结论」。**

当前已知 FAIL：无。当前阻塞：等待前端 v1.1「墨块托盘」增量交付（Lead 通知后再跑最终 E2E）。