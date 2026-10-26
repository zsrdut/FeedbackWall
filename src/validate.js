'use strict';

const DEFAULT_MAX_NICKNAME = 30;
const DEFAULT_MAX_CONTENT = 200;

/** 按 Unicode 码点计数，emoji 计为 1，前后端口径一致。 */
function codePointLength(value) {
  return Array.from(value).length;
}

function fail(code, message) {
  return { ok: false, code, message };
}

/**
 * 校验并归一化留言输入：昵称与内容都先 trim，再按码点校验长度。
 * @param {unknown} input 原始请求体
 * @param {{maxNickname?: number, maxContent?: number}} [limits]
 */
function validateMessageInput(input, limits = {}) {
  const maxNickname = limits.maxNickname ?? DEFAULT_MAX_NICKNAME;
  const maxContent = limits.maxContent ?? DEFAULT_MAX_CONTENT;
  const source = input !== null && typeof input === 'object' ? input : {};

  const nickname = typeof source.nickname === 'string' ? source.nickname.trim() : '';
  const content = typeof source.content === 'string' ? source.content.trim() : '';

  if (!nickname) {
    return fail('NICKNAME_REQUIRED', '请输入昵称');
  }
  if (codePointLength(nickname) > maxNickname) {
    return fail('NICKNAME_TOO_LONG', `昵称最多 ${maxNickname} 字`);
  }
  if (!content) {
    return fail('CONTENT_REQUIRED', '请输入留言内容');
  }
  if (codePointLength(content) > maxContent) {
    return fail('CONTENT_TOO_LONG', `留言内容最多 ${maxContent} 字`);
  }

  return { ok: true, value: { nickname, content } };
}

module.exports = {
  DEFAULT_MAX_NICKNAME,
  DEFAULT_MAX_CONTENT,
  codePointLength,
  validateMessageInput,
};
