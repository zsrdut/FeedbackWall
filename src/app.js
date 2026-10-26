'use strict';

const http = require('node:http');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { validateMessageInput } = require('./validate');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
};

const COMMON_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...COMMON_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function sendError(res, status, code, message, extraHeaders = {}) {
  sendJson(res, status, { error: { code, message } }, extraHeaders);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    ...COMMON_HEADERS,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

/** 读取请求体，超过上限后不再累积数据，避免大请求占用内存。 */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];

    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve({ tooLarge, buffer: Buffer.concat(chunks) }));
    req.on('error', reject);
  });
}

/**
 * 创建 HTTP 服务（不监听端口），便于测试注入临时 store 与端口。
 * @param {{store: ReturnType<import('./store').createMessageStore>, publicDir: string,
 *          maxBodyBytes?: number, maxNickname?: number, maxContent?: number,
 *          logger?: {info: Function, warn: Function, error: Function}}} options
 */
function createApp(options) {
  const store = options.store;
  const publicDir = path.resolve(options.publicDir);
  const maxBodyBytes = options.maxBodyBytes ?? 8192;
  const maxNickname = options.maxNickname;
  const maxContent = options.maxContent;
  const logger = options.logger || console;

  async function handleApi(req, res, pathname) {
    if (pathname === '/api/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendError(res, 405, 'METHOD_NOT_ALLOWED', '方法不允许', { Allow: 'GET, HEAD' });
        return;
      }
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (pathname === '/api/messages') {
      if (req.method === 'GET') {
        sendJson(res, 200, { messages: store.list() });
        return;
      }

      if (req.method === 'POST') {
        const { tooLarge, buffer } = await readBody(req, maxBodyBytes);
        if (tooLarge) {
          sendError(res, 413, 'PAYLOAD_TOO_LARGE', '请求体过大', { Connection: 'close' });
          return;
        }

        let parsed;
        try {
          parsed = JSON.parse(buffer.toString('utf8'));
        } catch {
          sendError(res, 400, 'INVALID_JSON', '请求体不是合法 JSON');
          return;
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          sendError(res, 400, 'INVALID_JSON', '请求体必须是 JSON 对象');
          return;
        }

        const result = validateMessageInput(parsed, { maxNickname, maxContent });
        if (!result.ok) {
          sendError(res, 400, result.code, result.message);
          return;
        }

        try {
          const message = await store.add(result.value);
          sendJson(res, 201, { message });
        } catch (error) {
          logger.error(`[api] 写入留言失败：${error.stack || error.message}`);
          sendError(res, 500, 'INTERNAL_ERROR', '服务器内部错误，请稍后重试');
        }
        return;
      }

      sendError(res, 405, 'METHOD_NOT_ALLOWED', '方法不允许', { Allow: 'GET, POST' });
      return;
    }

    sendError(res, 404, 'NOT_FOUND', '接口不存在');
  }

  async function handleStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, 'Method Not Allowed');
      return;
    }

    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      sendText(res, 404, 'Not Found');
      return;
    }
    if (decoded.includes('\0')) {
      sendText(res, 404, 'Not Found');
      return;
    }

    const relativePath = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
    const filePath = path.resolve(publicDir, relativePath);
    if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep)) {
      sendText(res, 404, 'Not Found');
      return;
    }

    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      sendText(res, 404, 'Not Found');
      return;
    }
    if (!stat.isFile()) {
      sendText(res, 404, 'Not Found');
      return;
    }

    let body;
    try {
      body = await fsp.readFile(filePath);
    } catch (error) {
      logger.error(`[static] 读取失败 ${path.basename(filePath)}：${error.message}`);
      sendText(res, 500, 'Internal Server Error');
      return;
    }

    res.writeHead(200, {
      ...COMMON_HEADERS,
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  const server = http.createServer((req, res) => {
    const startedAt = process.hrtime.bigint();
    let pathname = '/';
    try {
      pathname = new URL(req.url || '/', 'http://localhost').pathname;
    } catch {
      pathname = '/';
    }

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      logger.info(`${req.method} ${pathname} ${res.statusCode} ${durationMs.toFixed(1)}ms`);
    });

    const run = pathname === '/api' || pathname.startsWith('/api/')
      ? handleApi(req, res, pathname)
      : handleStatic(req, res, pathname);

    Promise.resolve(run).catch((error) => {
      logger.error(`[server] 未捕获异常：${error.stack || error.message}`);
      if (!res.headersSent) {
        sendError(res, 500, 'INTERNAL_ERROR', '服务器内部错误，请稍后重试');
      } else {
        res.destroy();
      }
    });
  });

  return server;
}

module.exports = { createApp, MIME_TYPES };
