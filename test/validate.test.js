'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateMessageInput, codePointLength } = require('../src/validate');

test('合法输入被 trim 后返回', () => {
  const result = validateMessageInput({ nickname: '  小明  ', content: '  你好  ' });
  assert.deepEqual(result, { ok: true, value: { nickname: '小明', content: '你好' } });
});

test('空昵称与纯空白昵称被拒绝', () => {
  for (const nickname of ['', '   ', '\n\t']) {
    const result = validateMessageInput({ nickname, content: '内容' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'NICKNAME_REQUIRED');
  }
});

test('非字符串昵称按空处理', () => {
  const result = validateMessageInput({ nickname: 123, content: '内容' });
  assert.equal(result.code, 'NICKNAME_REQUIRED');
});

test('昵称 30 字通过、31 字拒绝', () => {
  const ok = validateMessageInput({ nickname: 'a'.repeat(30), content: '内容' });
  assert.equal(ok.ok, true);

  const tooLong = validateMessageInput({ nickname: 'a'.repeat(31), content: '内容' });
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.code, 'NICKNAME_TOO_LONG');
});

test('内容 200 字通过、201 字拒绝', () => {
  const ok = validateMessageInput({ nickname: '小明', content: 'a'.repeat(200) });
  assert.equal(ok.ok, true);

  const tooLong = validateMessageInput({ nickname: '小明', content: 'a'.repeat(201) });
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.code, 'CONTENT_TOO_LONG');
});

test('空内容与纯空白内容被拒绝', () => {
  for (const content of ['', '   ', '\n']) {
    const result = validateMessageInput({ nickname: '小明', content });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'CONTENT_REQUIRED');
  }
});

test('按 Unicode 码点计数：emoji 计为 1', () => {
  assert.equal(codePointLength('😀'), 1);
  assert.equal(codePointLength('a😀b'), 3);

  const result = validateMessageInput({ nickname: '😀'.repeat(30), content: '😀'.repeat(200) });
  assert.equal(result.ok, true);

  const tooLong = validateMessageInput({ nickname: '小明', content: '😀'.repeat(201) });
  assert.equal(tooLong.code, 'CONTENT_TOO_LONG');
});

test('自定义长度上限生效', () => {
  const result = validateMessageInput(
    { nickname: 'abcd', content: 'abcd' },
    { maxNickname: 3, maxContent: 3 },
  );
  assert.equal(result.code, 'NICKNAME_TOO_LONG');
});

test('非对象输入按空表单处理', () => {
  for (const input of [null, undefined, 'text', 42, []]) {
    const result = validateMessageInput(input);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'NICKNAME_REQUIRED');
  }
});
