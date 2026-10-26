---
spec_id: SPEC-7145999187
title: 留言墙 Demo 技术设计
status: draft
template_id: 10983146
schema_version: 1
linked_spec: SPEC-7145999187
baseline_design: none
depends_on_designs: []
supersedes_designs: []
created_at: 2026-10-26T16:50:00+08:00
updated_at: 2026-10-26T16:50:00+08:00
---

# Design: 留言墙 Demo

> Spec 回答 What/Why，Design 回答 How。
> 标识符（REQ/API/FIELD/STATE/NFR/DEP-xxx）沿用 Spec，不重新编号。
> 如果 Design 与 Spec 冲突，以 Spec 为准；如果需求不清楚，先提问再设计。

---

# 1. 方案概述

采用**单进程 Node.js 服务 + 原生前端**的最小单体方案：

- 一个 `server.js` 进程同时提供静态页面（`public/`）与 JSON API（`/api/messages`），同源部署，无跨域与反向代理依赖。
- 运行时零第三方依赖，仅使用 Node 内置 `node:http`、`node:fs`、`node:crypto`，部署时无需 `npm install` 联网安装。
- 留言持久化到 `data/messages.json`：启动时加载进内存，新增时「串行队列 + 临时文件 + `rename` 原子替换」，保证并发写入不损坏文件、重启不丢数据。
- 前端为原生 HTML/CSS/JS，无构建步骤；提交使用 `fetch`，渲染使用 DOM API（`textContent`）防 XSS。

该方案直接满足 Spec 的 API 契约与「可独立启动」要求，并规避空仓库缺少脚手架、部署环境可能无法联网装包的风险。

## 1.1 影响范围

| 模块 / 层 | 文件或目录 | 改动说明 | 关联需求 |
|-----------|------------|----------|----------|
| 接口 | `server.js`、`src/app.js` | 新增 HTTP 服务、路由（`/`、`/api/messages`、`/api/health`）、JSON 解析与错误映射 | REQ-004 |
| 服务逻辑 | `src/validate.js` | 昵称/内容 trim、码点计数、错误码生成 | REQ-003 |
| 数据模型 | `src/store.js` | 留言读取、追加、倒序输出、文件加载与原子持久化 | REQ-001、REQ-002 |
| 存储 / 数据库 | `data/messages.json`（运行时生成） | JSON 文件存储，无数据库 | REQ-001、REQ-002 |
| 前端 | `public/index.html`、`public/styles.css`、`public/app.js` | 列表渲染、表单、校验、loading、空态/错误态 | REQ-001、REQ-002、REQ-003 |
| 外部依赖 | — | 无新增运行时依赖 | — |
| 配置 | 环境变量（`PORT`、`HOST`、`DATA_DIR`、`MAX_*`） | 端口、监听地址、数据目录、长度上限 | NFR |
| 测试 | `test/*.test.js` | 校验、存储、接口集成测试（`node --test`） | 全部 |
| 文档 | `README.md`、`docs/spec.md`、`docs/design.md` | 运行说明、契约与设计留档 | — |

## 1.2 关键决策

- **单体 Node 服务 vs 前后端分离**：选单体。理由是 API 与页面同源，部署只需一个进程与一个端口；演示环境不需要独立网关、CORS 与两套构建。
- **`node:http` vs Express**：选 `node:http` 零依赖。理由是仓库为空、部署环境网络不确定，`npm install` 是额外失败点；本需求只有 3 个路由，手写路由成本低。
- **JSON 文件 vs 内存 vs SQLite**：选 JSON 文件 + 内存缓存。理由是需要「重启不丢」但又不想引入数据库依赖；演示数据量（≤500 条）下全量读写足够。
- **排序口径**：用**写入顺序倒序**（`messages.slice().reverse()`）而非按 `createdAt` 排序。理由是同一毫秒内的多条留言时间戳相同，写入顺序能稳定表达「最新在前」，不受时钟回拨影响。
- **字数口径**：统一 Unicode 码点（`Array.from(s).length`），前后端一致；不使用 `maxlength`，避免 emoji 被计为 2。
- **提交后刷新**：`POST` 成功后直接用返回的 `message` 前插并**再拉一次** `GET /api/messages` 以服务端为准，避免本地状态与服务端漂移。
- **无框架、无构建**：原生 JS + CSS，`npm start` 即运行，减少部署链路风险。

---

# 2. 实现设计

## 2.1 文件清单

| 文件路径 | 新增/修改 | 职责 |
|----------|-----------|------|
| `package.json` | 新增 | `name/version/private`、`engines.node >= 20`、`start`/`test` 脚本，无 dependencies |
| `server.js` | 新增 | 读取环境变量、创建 store、启动 HTTP 服务、优雅退出（SIGTERM/SIGINT） |
| `src/app.js` | 新增 | 创建 `http.Server`：路由分发、请求体读取与大小限制、静态文件服务、统一错误响应、访问日志 |
| `src/validate.js` | 新增 | `validateMessageInput({ nickname, content }, limits)` → `{ ok, value }` 或 `{ ok:false, code, message }` |
| `src/store.js` | 新增 | `createMessageStore({ dataDir, maxNickname, maxContent })`：`init()`、`list()`、`add()`、`health()` |
| `public/index.html` | 新增 | 页面结构：标题、提交表单、提示区、列表区、空态/错误态模板 |
| `public/styles.css` | 新增 | 布局与视觉：卡片列表、表单、按钮 loading、提示条、响应式（≥360px） |
| `public/app.js` | 新增 | 状态管理、`fetch` 调用、表单校验、渲染（`textContent`）、字数统计、防重复提交 |
| `test/validate.test.js` | 新增 | 校验边界：空、空白、200/201 字、emoji、trim |
| `test/store.test.js` | 新增 | 追加/倒序/持久化/重启加载/并发写入 |
| `test/api.test.js` | 新增 | 接口集成：GET/POST/400/404/405/413/静态资源/路径穿越 |
| `data/.gitkeep` | 新增 | 保留数据目录；`data/messages.json` 加入 `.gitignore` |
| `.gitignore` | 新增 | 忽略 `node_modules/`、`data/messages.json`、`.DS_Store` |
| `README.md` | 修改 | 项目说明、启动方式、环境变量、API 摘要、存储与部署限制 |
| `docs/spec.md`、`docs/design.md`、`docs/prototype/index.html` | 新增 | 需求、设计与交互原型留档 |

> 目录约定：业务逻辑集中在 `src/`，静态资源集中在 `public/`，测试集中在 `test/`；`server.js` 只做启动装配，便于测试直接 `createApp()` 起临时端口。

## 2.2 数据模型

| 对象 / 表 | 字段 | 类型 | 说明 | 关联 FIELD |
|-----------|------|------|------|------------|
| Message | `id` | string | `crypto.randomUUID()` | id |
| Message | `nickname` | string | trim 后 1–30 字 | nickname |
| Message | `content` | string | trim 后 1–200 字，保留内部换行 | content |
| Message | `createdAt` | string | `new Date().toISOString()`，UTC | createdAt |
| 存储文件 | `version` | number | 固定 `1`，便于后续迁移 | — |
| 存储文件 | `messages` | Message[] | 按写入顺序追加 | — |

存储文件形态：

```json
{
  "version": 1,
  "messages": [
    {
      "id": "0f1c2f0e-6f2a-4f0e-9c39-1f0f0e6b8a11",
      "nickname": "小明",
      "content": "第一条留言",
      "createdAt": "2026-10-26T08:50:00.000Z"
    }
  ]
}
```

加载容错：
- 文件不存在 → 视为空列表，首次写入时创建目录与文件。
- 文件存在但 JSON 解析失败 → **不覆盖**，将原文件重命名为 `messages.corrupt-<timestamp>.json`，以空列表启动并输出告警日志（避免静默丢数据）。
- 结构非法（`messages` 不是数组）→ 同上按损坏处理。

## 2.3 数据库变更

无数据库变更（使用 JSON 文件存储）。

文件级「迁移」与回滚：
- 初始化：`fs.mkdir(dataDir, { recursive: true })`；文件不存在时第一次写入创建。
- 升级：读取时校验 `version === 1`；未来版本号变化时按版本分支迁移，本次无。
- 回滚：删除 `data/messages.json`（或恢复备份）即可回到空列表；代码回滚只需切回上一版本重启，无 schema 强耦合。

## 2.4 接口变更

| 接口 | 类型 | 请求变化 | 响应变化 | 兼容性 |
|------|------|----------|----------|--------|
| `GET /api/messages` | 新增 | 无参数 | 200 `{ "messages": Message[] }`，最新在前 | 新增，兼容 |
| `POST /api/messages` | 新增 | JSON `{ "nickname": string, "content": string }` | 201 `{ "message": Message }`；400/413/500 错误体 | 新增，兼容 |
| `GET /api/health` | 新增 | 无 | 200 `{ "status": "ok", "uptime": number }` | 新增，兼容 |
| 其他 `/api/*` | 新增 | — | 404 `{ "error": { "code": "NOT_FOUND", "message": "接口不存在" } }` | 新增，兼容 |
| `GET /api/messages`（非 GET/POST） | 新增 | — | 405 + `Allow: GET, POST` | 新增，兼容 |

请求/响应示例：

```http
POST /api/messages
Content-Type: application/json

{ "nickname": "小明", "content": "你好，留言墙！" }
```

```http
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8

{ "message": { "id": "…", "nickname": "小明", "content": "你好，留言墙！", "createdAt": "2026-10-26T08:50:00.000Z" } }
```

```http
HTTP/1.1 400 Bad Request

{ "error": { "code": "CONTENT_TOO_LONG", "message": "留言内容最多 200 字" } }
```

错误码与 HTTP 状态映射：

| 错误码 | HTTP | 触发条件 |
|--------|------|----------|
| `NICKNAME_REQUIRED` | 400 | 昵称 trim 后为空 / 非字符串 |
| `NICKNAME_TOO_LONG` | 400 | 昵称码点数 > 30 |
| `CONTENT_REQUIRED` | 400 | 内容 trim 后为空 / 非字符串 |
| `CONTENT_TOO_LONG` | 400 | 内容码点数 > 200 |
| `INVALID_JSON` | 400 | 请求体不是合法 JSON 对象 |
| `PAYLOAD_TOO_LARGE` | 413 | 请求体 > 8 KB |
| `NOT_FOUND` | 404 | 未知路径 / 越权静态路径 |
| `METHOD_NOT_ALLOWED` | 405 | `/api/messages` 使用 GET/POST 以外方法 |
| `INTERNAL_ERROR` | 500 | 未捕获异常或存储写入失败（响应不含堆栈） |

## 2.5 核心流程

**提交留言（REQ-002/REQ-003）**

1. 前端 `submit` 事件：阻止默认行为；若 `submitting` 为真直接返回（防重复）。
2. 前端 `trim()` 后按码点校验：昵称空 → `NICKNAME_REQUIRED` 提示；内容空 → `CONTENT_REQUIRED`；超长 → 对应提示。校验失败不发请求，焦点移到第一个错误字段。
3. 置 `submitting = true`：按钮 `disabled`、文案改为「提交中…」、`aria-busy="true"`。
4. `fetch('/api/messages', { method:'POST', headers:{'Content-Type':'application/json'}, body })`。
5. 服务端：读取请求体（累计 > 8 KB 立即 413 并销毁连接）→ `JSON.parse` → 校验（同口径，trim 后存）→ `store.add()`。
6. `store.add()`：入队串行执行 → 追加到内存数组 → 原子写文件（`messages.json.tmp` → `rename`）→ 返回新对象；写失败则从内存数组弹出该条，向上抛错 → 500。
7. 前端收到 201：清空表单与字数计数、展示成功提示（2s 自动消失）、`await loadMessages()` 重新拉取并渲染（服务端为准）。
8. 前端收到 4xx/5xx：解析错误体，展示「提交失败：<message>」，**保留输入**，按钮恢复。
9. `finally`：`submitting = false`，按钮恢复；异常（断网）同样提示「网络异常，请稍后重试」。

**列表加载（REQ-001）**

1. 页面 `DOMContentLoaded` → `loadMessages()`：列表区显示「加载中…」。
2. `GET /api/messages`，200 → `messages.length === 0` 显示空态，否则按序渲染卡片（昵称、格式化时间、内容）。
3. 失败/非 200 → 列表区显示错误提示与「重试」按钮，点击重新执行步骤 1。
4. 渲染方式：`document.createElement` + `textContent`；内容容器 `white-space: pre-wrap`，不使用 `innerHTML`。

**时间格式化**：`new Date(createdAt)` 有效时，用 `Intl.DateTimeFormat` 或手工补零输出 `YYYY-MM-DD HH:mm`（本地时区）；无效时回退展示原始字符串。

## 2.6 状态变化

| 操作 | 前置状态 | 目标状态 | 说明 |
|------|----------|----------|------|
| 页面初始化 | 未加载 | 列表加载中 | 显示加载占位 |
| 列表成功 | 加载中 | 有数据 / 空态 | 由 `messages.length` 决定 |
| 列表失败 | 加载中 | 列表错误 | 提供重试 |
| 点击提交（校验通过） | idle | submitting | 按钮禁用、`aria-busy` |
| POST 201 | submitting | idle | 成功提示、清空表单、重新加载列表 |
| POST 4xx/5xx/网络错误 | submitting | idle | 错误提示、保留输入 |
| 校验失败 | idle | idle | 字段错误提示，不发请求 |

## 2.7 异步处理

| 任务 / 事件 | 触发时机 | 处理逻辑 | 失败处理 |
|-------------|----------|----------|----------|
| 文件持久化 | 每次 `POST` 成功 | 内存追加后串行写：写 `messages.json.tmp` → `fs.rename` 覆盖 | 抛出错误 → 内存回滚该条 → 返回 500 `INTERNAL_ERROR`，日志记录原因 |
| 进程退出 | `SIGTERM` / `SIGINT` | 停止接收新连接，等待进行中的写入队列清空后退出（超时 5s 强制退出） | 超时强制退出，日志告警 |
| 启动加载 | 进程启动 | 读取并解析 `messages.json`，构建内存数组 | 解析失败按损坏文件隔离（见 2.2），以空列表启动 |

## 2.8 外部依赖

无新增外部依赖。运行环境要求：Node.js ≥ 20（当前环境 v22.21.0），无数据库、无 Redis、无对象存储。

| 依赖 | 用途 | 超时 / 重试 | 降级策略 |
|------|------|-------------|----------|
| Node.js 内置模块 | HTTP、文件、UUID | 无网络调用 | — |

## 2.9 配置

| 配置项 | 默认值 | 用途 | 生效范围 |
|--------|--------|------|----------|
| `PORT` | `3000` | HTTP 监听端口 | 进程启动 |
| `HOST` | `0.0.0.0` | 监听地址（容器内需 0.0.0.0） | 进程启动 |
| `DATA_DIR` | `./data` | 留言文件目录（容器部署指向持久卷） | 进程启动 |
| `MAX_NICKNAME_LENGTH` | `30` | 昵称码点上限（前后端需一致，前端由页面内联常量写入） | 进程启动 |
| `MAX_CONTENT_LENGTH` | `200` | 内容码点上限（同上） | 进程启动 |
| `MAX_BODY_BYTES` | `8192` | POST 请求体上限 | 进程启动 |

> 说明：前端不从服务端读取配置，保持前后端常量一致（30/200）；若调整上限需同步修改 `public/app.js` 中的常量，已在 README 标注。

---

# 3. 兼容性与迁移

| 影响对象 | 兼容策略 | 迁移步骤 |
|----------|----------|----------|
| 已有数据 | 仓库当前无数据；文件格式从 `version: 1` 开始 | 无 |
| 接口调用方 | 全部为新增接口，无历史调用方 | 无 |
| 配置 | 全部为新增环境变量，均有默认值 | 无 |
| 历史任务 / 用户 | 无 | 无 |
| 移动端 | 单列布局，窄屏（360px）下表单与卡片自适应 | 手工验证 |

---

# 4. 上线与回滚

| 步骤 | 动作 | 备注 |
|------|------|------|
| 1 | 合并并发布代码（工作分支 → `main`） | 无构建产物，源码即产物 |
| 2 | 在 Node 22 环境执行 `npm start`（无需 `npm install`） | 确认 `PORT`、`DATA_DIR`；容器需可写目录 |
| 3 | 冒烟：`GET /api/health` → 200；`GET /api/messages` → 200；`POST /api/messages` → 201 后列表首位可见 | 记录部署节点返回的实际 URL |
| 4 | 观察请求日志与错误日志 5 分钟；确认无 5xx、无写入失败告警 | — |

**回滚预案**：将部署版本切回 `main` 上一提交并重启进程。数据文件向后兼容（`version: 1`），回滚不需要数据变更；如需清空演示数据，停止进程后删除 `data/messages.json` 再启动。

**部署前置条件（阻塞项）**：部署节点必须支持常驻 Node 进程与自定义端口；若仅有静态托管（如 GitHub Pages），`/api/messages` 无法工作，需改用支持服务端运行时的平台后再上线。

---

# 5. 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 部署环境不支持常驻 Node / 无持久卷 | 无法提供 API 或重启丢数据 | 部署节点先行确认运行时；`DATA_DIR` 指向持久卷；README 写明限制 |
| 单实例文件存储 | 不支持多副本水平扩展，并发高时写放大 | 演示定位可接受；后续可替换 `store.js` 为数据库实现（接口不变） |
| 无鉴权 / 无限流 | 公网暴露可被灌水 | 仅部署在受控演示环境；如需公网需增加网关限流与鉴权（范围外） |
| 损坏文件被隔离后从空列表启动 | 用户感知为「留言消失」 | 保留 `messages.corrupt-*.json` 并打告警日志，便于人工恢复 |
| 前后端长度常量需手工同步 | 调整上限时不一致 | README 标注；默认值不变更即无影响 |

---

# 6. 测试要点

| 场景 | 方法 | 关联 REQ |
|------|------|----------|
| 正常主流程 | 启动服务 → GET 空列表 → POST 合法留言 → GET 首位为新留言；页面提交后自动刷新 | REQ-001/002 |
| 校验边界 | 昵称/内容为 `""`、`"   "`；内容 200 字（通过）、201 字（400）；昵称 30/31 字；emoji（`😀` 计 1） | REQ-003 |
| 异常处理 | 非法 JSON → 400 `INVALID_JSON`；9 KB 请求体 → 413；PUT `/api/messages` → 405；未知路径 → 404；存储目录只读 → 500 且不产生半条数据 | REQ-003/004 |
| 安全 | 提交 `<img src=x onerror=alert(1)>` 后页面仅显示文本、不执行脚本；`GET /../server.js`、`GET /%2e%2e/server.js` 返回 404 | NFR 安全 |
| 持久化 & 重启 | POST 后重启进程，GET 仍返回该留言；删除数据文件后启动为空列表 | NFR 可用性 |
| 并发写入 | 并行 20 个 POST，最终条数 = 20，文件可被 JSON 解析，无重复 id | REQ-002/004 |
| UI 状态 | 提交中按钮禁用且不可重复提交；提交失败保留输入；空态文案；列表失败可重试 | REQ-001/002 |
| 兼容性 / 回归 | Chrome/Edge/Safari 各一版 + 360px 视口；静态资源 200、404 正常 | NFR 兼容 |

**验证命令**：`npm test`（`node --test`）；`npm start` 后手工/脚本冒烟。
