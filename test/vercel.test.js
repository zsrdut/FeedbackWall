'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');

const { createVercelHandler } = require('../src/vercel');

test('Vercel handler 复用现有路由并支持提交/读取', async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'feedback-vercel-'));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  t.after(async () => {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    await fsp.rm(dir, { recursive: true, force: true });
  });

  const server = http.createServer(createVercelHandler());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const base = `http://127.0.0.1:${server.address().port}`;

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });

  const created = await fetch(`${base}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: 'Vercel', content: '你好，Serverless' }),
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.message.nickname, 'Vercel');

  const listed = await fetch(`${base}/api/messages`);
  assert.equal(listed.status, 200);
  const listedBody = await listed.json();
  assert.equal(listedBody.messages.length, 1);
  assert.equal(listedBody.messages[0].id, createdBody.message.id);

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /留言墙/);
});
