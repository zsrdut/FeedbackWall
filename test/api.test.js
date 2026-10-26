'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');

const { createMessageStore } = require('../src/store');
const { createApp } = require('../src/app');

const silentLogger = { info() {}, warn() {}, error() {} };

async function startServer(t, options = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'feedback-api-'));
  const store = createMessageStore({ dataDir: dir, logger: silentLogger });
  await store.init();

  const server = createApp({
    store,
    publicDir: path.join(__dirname, '..', 'public'),
    logger: silentLogger,
    ...options,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsp.rm(dir, { recursive: true, force: true });
  });

  return { base, store, dir };
}

function postJson(base, body) {
  return fetch(`${base}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function rawGet(base, rawPath) {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: url.hostname, port: url.port, method: 'GET', path: rawPath },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('GET /api/health 返回 200', async (t) => {
  const { base } = await startServer(t);
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('GET /api/messages 初始为空列表', async (t) => {
  const { base } = await startServer(t);
  const res = await fetch(`${base}/api/messages`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { messages: [] });
});

test('POST 合法留言返回 201，GET 最新在前', async (t) => {
  const { base } = await startServer(t);

  const first = await postJson(base, { nickname: ' 小明 ', content: ' 第一条 ' });
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  assert.deepEqual(Object.keys(firstBody.message).sort(), ['content', 'createdAt', 'id', 'nickname']);
  assert.equal(firstBody.message.nickname, '小明');
  assert.equal(firstBody.message.content, '第一条');
  assert.ok(!Number.isNaN(Date.parse(firstBody.message.createdAt)));

  const second = await postJson(base, { nickname: '小红', content: '第二条' });
  assert.equal(second.status, 201);

  const list = await fetch(`${base}/api/messages`);
  const listBody = await list.json();
  assert.deepEqual(listBody.messages.map((m) => m.content), ['第二条', '第一条']);
  assert.equal(listBody.messages[0].nickname, '小红');
});

test('内容刚好 200 字与 emoji 计数可通过', async (t) => {
  const { base } = await startServer(t);
  const res = await postJson(base, { nickname: '😀'.repeat(30), content: '😀'.repeat(200) });
  assert.equal(res.status, 201);
});

test('非法输入返回 400 与稳定错误码且不写入', async (t) => {
  const { base, store } = await startServer(t);

  const cases = [
    [{ nickname: '', content: '内容' }, 'NICKNAME_REQUIRED'],
    [{ nickname: '   ', content: '内容' }, 'NICKNAME_REQUIRED'],
    [{ nickname: 'a'.repeat(31), content: '内容' }, 'NICKNAME_TOO_LONG'],
    [{ nickname: '小明', content: '' }, 'CONTENT_REQUIRED'],
    [{ nickname: '小明', content: 'a'.repeat(201) }, 'CONTENT_TOO_LONG'],
  ];

  for (const [payload, code] of cases) {
    const res = await postJson(base, payload);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, code);
    assert.equal(typeof body.error.message, 'string');
  }

  assert.equal(store.count(), 0);

  const list = await fetch(`${base}/api/messages`);
  assert.deepEqual((await list.json()).messages, []);
});

test('非法 JSON 与数组请求体返回 400 INVALID_JSON', async (t) => {
  const { base } = await startServer(t);

  const invalid = await postJson(base, '{ broken');
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'INVALID_JSON');

  const arrayBody = await postJson(base, '[1,2,3]');
  assert.equal(arrayBody.status, 400);
  assert.equal((await arrayBody.json()).error.code, 'INVALID_JSON');
});

test('超过 8 KB 的请求体返回 413', async (t) => {
  const { base, store } = await startServer(t);
  const big = JSON.stringify({ nickname: '小明', content: 'a'.repeat(9000) });
  const res = await postJson(base, big);
  assert.equal(res.status, 413);
  assert.equal((await res.json()).error.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(store.count(), 0);
});

test('/api/messages 使用 PUT 返回 405 并带 Allow 头', async (t) => {
  const { base } = await startServer(t);
  const res = await fetch(`${base}/api/messages`, { method: 'PUT' });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'GET, POST');
  assert.equal((await res.json()).error.code, 'METHOD_NOT_ALLOWED');
});

test('未知接口与未知路径返回 404', async (t) => {
  const { base } = await startServer(t);

  const api = await fetch(`${base}/api/unknown`);
  assert.equal(api.status, 404);
  assert.equal((await api.json()).error.code, 'NOT_FOUND');

  const page = await fetch(`${base}/not-found`);
  assert.equal(page.status, 404);
});

test('首页与静态资源可访问', async (t) => {
  const { base } = await startServer(t);

  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  const html = await index.text();
  assert.match(html, /留言墙/);
  assert.match(html, /\/app\.js/);

  const script = await fetch(`${base}/app.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);

  const style = await fetch(`${base}/styles.css`);
  assert.equal(style.status, 200);
  assert.match(style.headers.get('content-type'), /text\/css/);
});

test('路径穿越无法读取仓库文件', async (t) => {
  const { base } = await startServer(t);

  for (const rawPath of ['/../server.js', '/%2e%2e/server.js', '/%2e%2e%2fserver.js']) {
    const res = await rawGet(base, rawPath);
    assert.equal(res.statusCode, 404, rawPath);
  }
});

test('留言内容按纯文本原样存储，不做 HTML 解释', async (t) => {
  const { base } = await startServer(t);
  const payload = '<img src=x onerror=alert(1)>';

  const created = await postJson(base, { nickname: '<b>昵称</b>', content: payload });
  assert.equal(created.status, 201);

  const body = await created.json();
  assert.equal(body.message.content, payload);
  assert.equal(body.message.nickname, '<b>昵称</b>');
});

test('存储写入失败时返回 500 且不返回堆栈', async (t) => {
  const server = createApp({
    store: {
      list: () => [],
      add: () => Promise.reject(new Error('磁盘不可写 /srv/data/messages.json')),
    },
    publicDir: path.join(__dirname, '..', 'public'),
    logger: silentLogger,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await postJson(base, { nickname: '小明', content: '内容' });
  assert.equal(res.status, 500);

  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(body.error.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(text, /磁盘不可写|messages\.json|stack|\bat .*\.js/i);

  const list = await fetch(`${base}/api/messages`);
  assert.equal(list.status, 200);
  assert.deepEqual(await list.json(), { messages: [] });
});
