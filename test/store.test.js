'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');

const { createMessageStore } = require('../src/store');

const silentLogger = { info() {}, warn() {}, error() {} };

async function tempDir(t) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'feedback-store-'));
  t.after(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test('数据文件不存在时以空列表启动', async (t) => {
  const dir = await tempDir(t);
  const store = createMessageStore({ dataDir: dir, logger: silentLogger });
  await store.init();
  assert.deepEqual(store.list(), []);
  assert.equal(store.count(), 0);
});

test('新增留言后最新在前，字段完整', async (t) => {
  const dir = await tempDir(t);
  const store = createMessageStore({ dataDir: dir, logger: silentLogger });
  await store.init();

  const first = await store.add({ nickname: '小明', content: '第一条' });
  const second = await store.add({ nickname: '小红', content: '第二条' });

  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(first.nickname, '小明');
  assert.equal(second.content, '第二条');
  assert.ok(!Number.isNaN(Date.parse(first.createdAt)));

  const messages = store.list();
  assert.deepEqual(messages.map((m) => m.content), ['第二条', '第一条']);
});

test('留言持久化后重新初始化仍可读取', async (t) => {
  const dir = await tempDir(t);
  const store = createMessageStore({ dataDir: dir, logger: silentLogger });
  await store.init();
  const created = await store.add({ nickname: '持久化', content: '重启不丢' });
  await store.flush();

  const reopened = createMessageStore({ dataDir: dir, logger: silentLogger });
  await reopened.init();
  assert.deepEqual(reopened.list(), [created]);
});

test('并发写入 20 条不丢数据且文件可解析', async (t) => {
  const dir = await tempDir(t);
  const store = createMessageStore({ dataDir: dir, logger: silentLogger });
  await store.init();

  const created = await Promise.all(
    Array.from({ length: 20 }, (_, i) => store.add({ nickname: `用户${i}`, content: `留言${i}` })),
  );

  assert.equal(store.count(), 20);
  assert.equal(new Set(created.map((m) => m.id)).size, 20);

  const raw = await fsp.readFile(store.filePath, 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.messages.length, 20);
  assert.deepEqual(store.list().map((m) => m.id), created.slice().reverse().map((m) => m.id));
});

test('损坏的数据文件被隔离，服务以空列表启动', async (t) => {
  const dir = await tempDir(t);
  await fsp.writeFile(path.join(dir, 'messages.json'), '{ not json', 'utf8');

  const store = createMessageStore({ dataDir: dir, logger: silentLogger });
  await store.init();

  assert.deepEqual(store.list(), []);
  const files = await fsp.readdir(dir);
  assert.ok(files.some((name) => name.startsWith('messages.corrupt-') && name.endsWith('.json')));
  assert.ok(!files.includes('messages.json'));
});

test('持久化失败时回滚内存数据并抛出错误', async (t) => {
  const dir = await tempDir(t);
  const store = createMessageStore({ dataDir: dir, logger: silentLogger });
  await store.init();

  // 用同名文件占住数据目录路径，使后续 mkdir/写入必然失败
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.writeFile(dir, 'not-a-directory', 'utf8');

  await assert.rejects(() => store.add({ nickname: '小明', content: '内容' }));
  assert.equal(store.count(), 0);
  assert.deepEqual(store.list(), []);
});

test('结构非法的数据文件同样被隔离', async (t) => {
  const dir = await tempDir(t);
  await fsp.writeFile(path.join(dir, 'messages.json'), JSON.stringify({ version: 1, messages: 'oops' }), 'utf8');

  const store = createMessageStore({ dataDir: dir, logger: silentLogger });
  await store.init();

  assert.deepEqual(store.list(), []);
  const files = await fsp.readdir(dir);
  assert.ok(files.some((name) => name.startsWith('messages.corrupt-')));
});
