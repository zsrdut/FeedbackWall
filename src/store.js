'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const STORE_VERSION = 1;
const FILE_NAME = 'messages.json';

function cloneMessage(message) {
  return {
    id: message.id,
    nickname: message.nickname,
    content: message.content,
    createdAt: message.createdAt,
  };
}

/**
 * 留言存储：内存数组 + JSON 文件原子持久化。
 * 写入串行执行，保证并发 POST 不会互相覆盖或产生半写文件。
 */
function createMessageStore(options = {}) {
  const dataDir = path.resolve(options.dataDir || path.join(process.cwd(), 'data'));
  const logger = options.logger || console;
  const filePath = path.join(dataDir, FILE_NAME);

  /** @type {Array<{id:string,nickname:string,content:string,createdAt:string}>} */
  let messages = [];
  let queue = Promise.resolve();
  let tmpCounter = 0;

  function corruptBackupPath() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(dataDir, `messages.corrupt-${stamp}.json`);
  }

  async function quarantineCorruptFile(reason) {
    try {
      const backup = corruptBackupPath();
      await fsp.rename(filePath, backup);
      logger.warn(`[store] 数据文件不可用（${reason}），已隔离到 ${path.basename(backup)}，以空列表启动`);
    } catch (error) {
      logger.error(`[store] 数据文件不可用（${reason}），且隔离失败：${error.message}`);
    }
  }

  async function init() {
    await fsp.mkdir(dataDir, { recursive: true });

    let raw;
    try {
      raw = await fsp.readFile(filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        messages = [];
        return;
      }
      throw error;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await quarantineCorruptFile('JSON 解析失败');
      messages = [];
      return;
    }

    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.messages)) {
      await quarantineCorruptFile('结构非法');
      messages = [];
      return;
    }
    if (parsed.version !== STORE_VERSION) {
      await quarantineCorruptFile(`不支持的存储版本 ${String(parsed.version)}`);
      messages = [];
      return;
    }

    messages = parsed.messages
      .filter((item) => item && typeof item === 'object')
      .map(cloneMessage);
  }

  async function persist() {
    await fsp.mkdir(dataDir, { recursive: true });
    const payload = JSON.stringify({ version: STORE_VERSION, messages }, null, 2);
    tmpCounter += 1;
    const tmpPath = `${filePath}.tmp-${process.pid}-${tmpCounter}`;
    await fsp.writeFile(tmpPath, payload, 'utf8');
    try {
      await fsp.rename(tmpPath, filePath);
    } catch (error) {
      await fsp.rm(tmpPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  /** 最新在前：按写入顺序倒序，避免同一毫秒时间戳排序不稳定。 */
  function list() {
    return messages.slice().reverse().map(cloneMessage);
  }

  function count() {
    return messages.length;
  }

  /**
   * 追加一条留言；持久化失败时回滚内存并抛出错误。
   * @param {{nickname: string, content: string}} input 已完成校验与 trim
   */
  function add(input) {
    const task = queue.then(async () => {
      const message = {
        id: crypto.randomUUID(),
        nickname: input.nickname,
        content: input.content,
        createdAt: new Date().toISOString(),
      };
      messages.push(message);
      try {
        await persist();
      } catch (error) {
        messages.pop();
        throw error;
      }
      return cloneMessage(message);
    });
    queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  /** 等待进行中的写入完成，供优雅退出使用。 */
  async function flush(timeoutMs = 5000) {
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([queue, timeout]);
    clearTimeout(timer);
  }

  return {
    dataDir,
    filePath,
    init,
    list,
    count,
    add,
    flush,
    version: STORE_VERSION,
  };
}

module.exports = { createMessageStore, STORE_VERSION, FILE_NAME };
