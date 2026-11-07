// 墨馆 ink-museum · E2E 运行器
// 用法：
//   node tests/e2e/run.mjs                    # 早期冒烟（默认）
//   node tests/e2e/run.mjs --suite=early      # 同上
//   node tests/e2e/run.mjs --base=http://127.0.0.1:8790 --out=_qa-artifacts/early --headed --keep
// 退出码：0 全过 / 1 有失败 / 2 基建不可用（Chrome/playwright-core/dev server 起不来等）。

import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import {
  DEFAULT_BASE_URL,
  ARTIFACTS_ROOT,
  PROJECT_ROOT,
  InfraError,
  VIEWPORTS,
  captureViewport,
  ensureServer,
  launchBrowser,
  nowIso,
  prepareOutDir,
  readInstalledVersion,
  rel,
  snapshotProject,
} from './harness.mjs';

const USAGE = [
  '墨馆 E2E 运行器',
  '',
  '用法: node tests/e2e/run.mjs [选项]',
  '',
  '选项:',
  '  --suite=early       测试套件（当前实现了 early；full 为最终验收，待扩展）',
  '  --out=<dir>         产物目录（默认 _qa-artifacts/<suite>；相对项目根）',
  '  --base=<url>        目标站点（默认 http://127.0.0.1:8790）',
  '  --headed            有头模式（默认 headless）',
  '  --keep              不清理已有产物目录',
  '  --help              显示本帮助',
  '',
  '退出码: 0 全过 / 1 有失败 / 2 基建不可用',
].join('\n');

function parseArgs(argv) {
  const args = { suite: 'early', out: null, base: DEFAULT_BASE_URL, headed: false, keep: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { args.help = true; console.error('未知参数: ' + a); continue; }
    const body = a.slice(2);
    const eq = body.indexOf('=');
    const key = eq >= 0 ? body.slice(0, eq) : body;
    const inline = eq >= 0 ? body.slice(eq + 1) : undefined;
    const takeValue = () => (inline !== undefined ? inline : argv[(i += 1)]);
    if (key === 'suite') args.suite = takeValue();
    else if (key === 'out') args.out = takeValue();
    else if (key === 'base') args.base = takeValue();
    else if (key === 'headed') args.headed = true;
    else if (key === 'keep') args.keep = true;
    else if (key === 'help') args.help = true;
    else { args.help = true; console.error('未知参数: ' + a); }
  }
  return args;
}

function addCheck(result, id, description, pass, detail) {
  const entry = { id, description, status: pass ? 'pass' : 'fail', detail: detail || '' };
  result.checks.push(entry);
  if (!pass) result.failures.push({ id, description, detail: detail || '' });
  return entry;
}

function collectAcrossViewports(captures) {
  const consoleErrors = [];
  const pageErrors = [];
  const externalRequests = [];
  const requestFailures = [];
  const failedResponses = [];
  for (const cap of captures) {
    for (const item of cap.consoleErrors) consoleErrors.push({ viewport: cap.viewport.name, ...item });
    for (const item of cap.pageErrors) pageErrors.push({ viewport: cap.viewport.name, ...item });
    for (const item of cap.externalRequests) externalRequests.push({ viewport: cap.viewport.name, ...item });
    for (const item of cap.requestFailures) requestFailures.push({ viewport: cap.viewport.name, ...item });
    for (const item of cap.failedResponses) failedResponses.push({ viewport: cap.viewport.name, ...item });
  }
  return { consoleErrors, pageErrors, externalRequests, requestFailures, failedResponses };
}

function previewList(items, pick, limit = 5) {
  if (!items.length) return '';
  const shown = items.slice(0, limit).map((item) => pick(item)).join(' | ');
  return items.length > limit ? shown + ' ...（共 ' + items.length + ' 条）' : shown;
}

// ---------------------------------------------------------------------------
// 早期冒烟：打开 /?fresh=1，HTTP、标题、console、外链、三视口截图
// ---------------------------------------------------------------------------

async function runEarlySmoke(ctx) {
  const { result, browser, outDir, baseURL } = ctx;
  const targetPath = '/?fresh=1';
  const captures = [];

  for (const viewport of VIEWPORTS) {
    console.log('[qa] 视口 ' + viewport.name + ' ' + viewport.width + 'x' + viewport.height + ' ...');
    const cap = await captureViewport(browser, {
      baseURL,
      targetPath,
      viewport,
      outDir,
      label: 'early-' + viewport.name,
    });
    captures.push(cap);
    result.viewports.push(cap);
    if (cap.screenshot) result.artifacts.screenshots.push(cap.screenshot);
    console.log('[qa]   nav=' + (cap.navStatus === null ? (cap.navError || 'null') : cap.navStatus)
      + ' consoleErrors=' + cap.consoleErrors.length
      + ' pageErrors=' + cap.pageErrors.length
      + ' external=' + cap.externalRequests.length
      + ' failedResponses=' + cap.failedResponses.length
      + ' screenshot=' + (cap.screenshot || cap.screenshotError));
  }

  const aggregated = collectAcrossViewports(captures);
  result.resources = {
    consoleErrors: aggregated.consoleErrors,
    pageErrors: aggregated.pageErrors,
    externalRequests: aggregated.externalRequests,
    requestFailures: aggregated.requestFailures,
    failedResponses: aggregated.failedResponses,
    requestCounts: captures.map((cap) => ({ viewport: cap.viewport.name, count: cap.requestCount })),
  };

  const navSummary = captures.map((cap) => cap.viewport.name + '=' + (cap.navStatus === null ? (cap.navError || 'null') : cap.navStatus)).join(', ');
  addCheck(result, 'http.status.200', '打开 /?fresh=1 返回 HTTP 200', captures.every((cap) => cap.navStatus === 200), navSummary);

  const firstInfo = captures[0] ? captures[0].pageInfo : null;
  const title = firstInfo ? firstInfo.title : '';
  const titleIsReal = !!title && !/^https?:\/\//i.test(title) && title.trim() !== (captures[0] ? captures[0].requestedUrl : '');
  addCheck(result, 'page.title', '页面有真实标题（不是浏览器回退的 URL 标题）', titleIsReal, 'title=' + JSON.stringify(title));
  addCheck(result, 'page.title.museum', '标题含「墨馆」', /墨馆/.test(title), 'title=' + JSON.stringify(title));

  addCheck(
    result,
    'console.noErrors',
    '控制台无 error',
    aggregated.consoleErrors.length === 0,
    aggregated.consoleErrors.length === 0 ? '' : previewList(aggregated.consoleErrors, (e) => e.viewport + ': ' + e.text),
  );
  addCheck(
    result,
    'page.noPageErrors',
    '无未捕获 pageerror',
    aggregated.pageErrors.length === 0,
    aggregated.pageErrors.length === 0 ? '' : previewList(aggregated.pageErrors, (e) => e.viewport + ': ' + e.message),
  );
  addCheck(
    result,
    'network.noExternalRequests',
    '无外站请求（只允许本站资源）',
    aggregated.externalRequests.length === 0,
    aggregated.externalRequests.length === 0 ? '' : previewList(aggregated.externalRequests, (e) => e.viewport + ': ' + e.url),
  );

  const screenshotsOk = result.artifacts.screenshots.length === VIEWPORTS.length
    && captures.every((cap) => cap.screenshot && !cap.screenshotError);
  addCheck(result, 'screenshots.3viewports', '三种视口截图齐全（桌面/手机/窄屏）', screenshotsOk, result.artifacts.screenshots.join(', '));

  const shellOk = captures.some((cap) => cap.pageInfo && cap.pageInfo.bodyTextLength > 0 && cap.pageInfo.elementCount > 1);
  const shellDetail = captures.map((cap) => cap.viewport.name + ':' + (cap.pageInfo ? ('elements=' + cap.pageInfo.elementCount + ', textLen=' + cap.pageInfo.bodyTextLength) : 'no-pageInfo')).join(', ');
  addCheck(result, 'page.hasContent', '页面有可见内容（不是 404/空壳）', shellOk, shellDetail);

  // 记录型证据（早期不当作硬失败，最终验收会升级为硬门）：缺失资源 404 / 请求失败 / 横向溢出。
  result.hints = {
    horizontalOverflow: captures.filter((cap) => cap.pageInfo && cap.pageInfo.horizontalOverflow).map((cap) => cap.viewport.name),
    pageInfo: captures.map((cap) => cap.viewport.name + ': ' + JSON.stringify(cap.pageInfo || null)),
  };
  if (aggregated.failedResponses.length > 0) {
    result.warnings.push('本次记录到 ' + aggregated.failedResponses.length + ' 个 >=400 响应（前端/资产未就绪时属预期，最终验收按门处理）。');
  }
  if (aggregated.requestFailures.length > 0) {
    result.warnings.push('本次记录到 ' + aggregated.requestFailures.length + ' 个 requestfailed（如 ERR_ABORTED 可能为正常中断）。');
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    process.exitCode = 2;
    return;
  }

  const startedAt = nowIso();
  const t0 = Date.now();
  const outPath = args.out ? path.resolve(PROJECT_ROOT, args.out) : path.join(ARTIFACTS_ROOT, args.suite);
  let prepared;
  try {
    prepared = await prepareOutDir(outPath, { clean: !args.keep });
  } catch (err) {
    console.error('[qa] 产物目录准备失败：' + (err && err.message ? err.message : err));
    process.exitCode = 2;
    return;
  }

  const result = {
    suite: args.suite,
    ok: false,
    exitCode: 2,
    startedAt,
    finishedAt: null,
    durationMs: 0,
    target: { baseURL: args.base, targetPath: '/?fresh=1' },
    env: {
      node: process.version,
      platform: process.platform,
      cwd: process.cwd(),
      outDir: prepared.rel,
      outDirCleaned: prepared.cleaned,
      playwright: null,
      playwrightBrowser: null,
      chromePath: null,
      chromeVersion: null,
      headless: !args.headed,
    },
    server: null,
    projectSnapshot: null,
    viewports: [],
    checks: [],
    failures: [],
    warnings: [],
    resources: null,
    hints: null,
    summary: null,
    artifacts: { result: rel(path.join(prepared.outDir, 'result.json')), screenshots: [] },
  };

  let server = null;
  let browserHandle = null;
  try {
    server = await ensureServer({ baseURL: args.base, serverLogPath: path.join(prepared.outDir, 'server.log') });
    result.server = {
      mode: server.mode,
      baseURL: server.baseURL,
      startedByUs: server.startedByUs,
      pid: server.pid,
      warnings: server.warnings,
      serverLog: server.serverLogRel,
    };
    result.warnings.push(...server.warnings);
    console.log('[qa] dev server: mode=' + server.mode + ' base=' + server.baseURL + (server.pid ? ' pid=' + server.pid : ''));

    result.env.playwright = await readInstalledVersion('playwright-core');
    browserHandle = await launchBrowser({ headless: !args.headed });
    result.env.playwright = browserHandle.playwrightVersion || result.env.playwright;
    result.env.chromePath = browserHandle.executablePath;
    result.env.chromeVersion = browserHandle.version;
    console.log('[qa] chromium(playwright-core ' + browserHandle.playwrightVersion + ') + 系统 Chrome ' + browserHandle.version);

    result.projectSnapshot = await snapshotProject();

    const ctx = {
      result,
      server,
      browser: browserHandle.browser,
      outDir: prepared.outDir,
      baseURL: server.baseURL,
      args,
    };
    if (args.suite === 'early') {
      await runEarlySmoke(ctx);
    } else if (args.suite === 'full') {
      throw new Error('--suite=full 尚未实现：等 Lead 派发最终验收任务后扩展 tests/e2e/run.mjs。当前可用 --suite=early。');
    } else {
      throw new Error('未知 suite: ' + args.suite + '（可用：early）');
    }
  } catch (err) {
    if (err instanceof InfraError) {
      result.infraError = err.message;
      result.exitCode = 2;
      console.error('[qa] 基建不可用：' + err.message);
    } else {
      result.internalError = String(err && err.stack ? err.stack : err);
      result.exitCode = 1;
      console.error('[qa] 运行异常：' + result.internalError);
    }
  } finally {
    if (browserHandle && browserHandle.browser) {
      try { await browserHandle.browser.close(); } catch { /* ignore */ }
    }
    if (server && typeof server.stop === 'function') {
      try { await server.stop(); } catch (err) { result.warnings.push('关闭 dev server 失败：' + String(err && err.message ? err.message : err)); }
    }
    if (!result.infraError && !result.internalError) {
      const failed = result.checks.filter((check) => check.status !== 'pass');
      result.exitCode = failed.length === 0 ? 0 : 1;
    }
    result.finishedAt = nowIso();
    result.durationMs = Date.now() - t0;
    result.ok = result.exitCode === 0;
    const total = result.checks.length;
    const passed = result.checks.filter((check) => check.status === 'pass').length;
    result.summary = { checks: total, passed, failed: total - passed, warnings: result.warnings.length };
    try {
      await writeFile(path.join(prepared.outDir, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
    } catch (err) {
      console.error('[qa] 写 result.json 失败：' + String(err && err.message ? err.message : err));
    }
    printSummary(result, prepared.outDir);
    process.exitCode = result.exitCode;
  }
}

function printSummary(result, outDir) {
  console.log('');
  console.log('[qa] ===== 结果 =====');
  console.log('[qa] suite=' + result.suite + ' exit=' + result.exitCode + ' (' + (result.ok ? 'PASS' : 'FAIL') + ') 用时 ' + result.durationMs + 'ms');
  if (result.server) console.log('[qa] server=' + result.server.mode + ' ' + result.server.baseURL);
  if (result.env) console.log('[qa] env: node ' + result.env.node + ' | playwright-core ' + result.env.playwright + ' | Chrome ' + result.env.chromeVersion);
  if (result.infraError) console.log('[qa] 基建不可用: ' + result.infraError);
  if (result.internalError) console.log('[qa] 内部错误: ' + result.internalError.split('\n')[0]);
  for (const check of result.checks) {
    console.log('[qa]  ' + (check.status === 'pass' ? '[PASS]' : '[FAIL]') + ' ' + check.id + ' - ' + check.description + (check.detail ? ' :: ' + check.detail : ''));
  }
  for (const warning of result.warnings) console.log('[qa]  [WARN] ' + warning);
  console.log('[qa] 产物目录: ' + rel(outDir));
  if (result.artifacts && result.artifacts.screenshots.length) console.log('[qa] 截图: ' + result.artifacts.screenshots.join(', '));
  console.log('[qa] 结果 JSON: ' + (result.artifacts ? result.artifacts.result : ''));
}

main().catch((err) => {
  console.error('[qa] 未处理异常：' + String(err && err.stack ? err.stack : err));
  process.exitCode = 2;
});
