'use strict';

const path = require('node:path');

const { createRequestHandler } = require('./app');
const { createMessageStore } = require('./store');

const MAX_NICKNAME_LENGTH = Number(process.env.MAX_NICKNAME_LENGTH || 30);
const MAX_CONTENT_LENGTH = Number(process.env.MAX_CONTENT_LENGTH || 200);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 8192);

/**
 * Vercel Serverless 入口。
 *
 * Vercel 运行时只有 /tmp 可写，因此默认把留言文件放在 /tmp/feedback-wall。
 * 同一函数实例复用同一个 store；冷启动或多实例之间不共享数据。
 * 需要跨实例持久化时，请配置 DATA_DIR 指向外部持久存储，或改用常驻 Node 平台。
 */
function createVercelHandler() {
  let ready;

  function getHandler() {
    if (!ready) {
      const dataDir = path.resolve(
        process.env.DATA_DIR || (process.env.VERCEL ? '/tmp/feedback-wall' : path.join(__dirname, '..', 'data')),
      );
      ready = (async () => {
        const store = createMessageStore({ dataDir });
        await store.init();
        return createRequestHandler({
          store,
          publicDir: path.join(__dirname, '..', 'public'),
          maxBodyBytes: MAX_BODY_BYTES,
          maxNickname: MAX_NICKNAME_LENGTH,
          maxContent: MAX_CONTENT_LENGTH,
        });
      })();
    }
    return ready;
  }

  return async function handler(req, res) {
    try {
      const handle = await getHandler();
      return handle(req, res);
    } catch (error) {
      console.error(`[vercel] 初始化失败：${error.stack || error.message}`);
      if (!res.headersSent) {
        const body = JSON.stringify({
          error: { code: 'INTERNAL_ERROR', message: '服务器内部错误，请稍后重试' },
        });
        res.writeHead(500, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store',
        });
        res.end(body);
      } else {
        res.destroy();
      }
    }
  };
}

module.exports = { createVercelHandler };
