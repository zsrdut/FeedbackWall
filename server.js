'use strict';

const path = require('node:path');

const { createApp } = require('./src/app');
const { createMessageStore } = require('./src/store');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const MAX_NICKNAME_LENGTH = Number(process.env.MAX_NICKNAME_LENGTH || 30);
const MAX_CONTENT_LENGTH = Number(process.env.MAX_CONTENT_LENGTH || 200);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 8192);

async function main() {
  const store = createMessageStore({ dataDir: DATA_DIR });
  await store.init();

  const server = createApp({
    store,
    publicDir: path.join(__dirname, 'public'),
    maxBodyBytes: MAX_BODY_BYTES,
    maxNickname: MAX_NICKNAME_LENGTH,
    maxContent: MAX_CONTENT_LENGTH,
  });

  server.listen(PORT, HOST, () => {
    console.log(`[server] 留言墙已启动 http://${HOST}:${PORT}`);
    console.log(`[server] 数据文件：${store.filePath}（当前 ${store.count()} 条留言）`);
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] 收到 ${signal}，停止接收新连接…`);

    const forceTimer = setTimeout(() => {
      console.warn('[server] 等待写入超时，强制退出');
      process.exit(1);
    }, 6000);
    forceTimer.unref();

    server.close(async () => {
      await store.flush(5000);
      console.log('[server] 写入已落盘，进程退出');
      clearTimeout(forceTimer);
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error(`[server] 启动失败：${error.stack || error.message}`);
  process.exit(1);
});
