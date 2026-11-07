#!/usr/bin/env node
// 墨馆后端入口：node server/index.mjs
// 同端口：API（/api/*）+ 前台静态文件（PUBLIC_DIR，默认项目根）
// 环境变量：PORT / HOST / DATA_DIR / PUBLIC_DIR / TRUST_PROXY
//          SAVE_LIMIT_MAX / SAVE_LIMIT_WINDOW_MS / READ_LIMIT_MAX / READ_LIMIT_WINDOW_MS / RATE_LIMIT=off
// 命令行：--no-static 只跑 API。
import { startServer } from './app.mjs';
import { SERVER_VERSION, DEFAULTS } from './config.mjs';

async function main() {
  const app = await startServer({ env: process.env, argv: process.argv.slice(2) });
  const { config } = app;
  const url = app.url;
  const mode = config.noStatic ? 'api' : 'static+api';

  // 第一行是机器可读就绪信号（QA/部署脚本可匹配 listening on <url> mode=<mode>）
  console.log(`[ink-museum] listening on ${url} mode=${mode}`);
  console.log(`  墨馆后端 v${SERVER_VERSION}（零依赖 Node，API + 静态同端口）`);
  console.log(`  API      ${url}/api/health`);
  console.log(`  模式     ${mode}${config.noStatic ? '（--no-static：只跑 API）' : '（同端口托管前台静态文件）'}`);
  console.log(`  静态目录 ${config.noStatic ? '已禁用' : config.publicDir}`);
  console.log(`  数据目录 ${config.dataDir}`);
  console.log(`  限流     ${config.rateLimitEnabled
    ? `保存 ${config.saveLimit.max} 次/${Math.round(config.saveLimit.windowMs / 1000)}s，读 ${config.readLimit.max} 次/${Math.round(config.readLimit.windowMs / 1000)}s（可按 IP）`
    : '已关闭（RATE_LIMIT=off，仅限本地/测试）'}`);
  console.log(`  已载入画卷 ${app.store.size()} 条${app.store.badLines() > 0 ? `（跳过坏行 ${app.store.badLines()} 行）` : ''}`);
  if (!config.rateLimitEnabled) {
    console.warn('[ink-museum] 警告：限流已关闭，请勿用于公网生产环境');
  }
  console.log('  按 Ctrl+C 停止');

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[ink-museum] 收到 ${signal}，正在优雅退出…`);
    const force = setTimeout(() => {
      console.error('[ink-museum] 退出超时，强制结束');
      process.exit(1);
    }, config.shutdownTimeoutMs);
    force.unref?.();
    try {
      await app.close();
      clearTimeout(force);
      console.log('[ink-museum] 已退出');
      process.exit(0);
    } catch (error) {
      console.error(`[ink-museum] 退出时出错：${error?.message ?? error}`);
      process.exit(1);
    }
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (error) => {
    console.error('[ink-museum] 未捕获异常：', error);
    process.exit(1);
  });
  process.on('unhandledRejection', (error) => {
    console.error('[ink-museum] 未处理的 Promise 拒绝：', error);
    process.exit(1);
  });
}

main().catch((error) => {
  console.error(`[ink-museum] 启动失败：${error?.message ?? error}`);
  if (error?.code === 'EADDRINUSE') {
    console.error(`  端口 ${process.env.PORT ?? DEFAULTS.port} 已被占用，可用 PORT 环境变量换一个。`);
  }
  process.exit(1);
});