# 留言墙 Demo（FeedbackWall）

一个可独立运行的最小留言墙：访客填写昵称与留言后提交，首页按「最新在前」展示全部留言。

- 单进程 Node.js 服务，同时提供静态页面与 JSON API
- 零第三方运行时依赖，`npm start` 即可运行（无需 `npm install`）
- 留言持久化到 JSON 文件，重启不丢数据
- 前端原生 HTML/CSS/JS，无构建步骤

需求与设计留档见 [`docs/spec.md`](docs/spec.md)、[`docs/design.md`](docs/design.md)，交互原型见 [`docs/prototype/index.html`](docs/prototype/index.html)。

## 快速开始

要求 Node.js >= 20（开发环境使用 v22）。

```bash
npm start
# 打开 http://localhost:3000
```

自定义端口与数据目录：

```bash
PORT=8080 DATA_DIR=/var/lib/feedback-wall npm start
```

运行测试：

```bash
npm test
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | HTTP 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `./data` | 留言数据目录，容器部署时建议指向持久卷 |
| `MAX_NICKNAME_LENGTH` | `30` | 昵称最大长度（Unicode 码点） |
| `MAX_CONTENT_LENGTH` | `200` | 留言内容最大长度（Unicode 码点） |
| `MAX_BODY_BYTES` | `8192` | POST 请求体上限（字节） |

> 修改长度上限时，需同步修改 `public/app.js` 顶部的 `MAX_NICKNAME` / `MAX_CONTENT` 常量，保证前后端校验一致。

## API

| 接口 | 说明 |
|------|------|
| `GET /api/health` | 健康检查，返回 `{ "status": "ok" }` |
| `GET /api/messages` | 获取全部留言，最新在前：`{ "messages": Message[] }` |
| `POST /api/messages` | 新增留言，请求 `{ "nickname": string, "content": string }`，成功返回 `201 { "message": Message }` |

`Message`：`{ "id": string, "nickname": string, "content": string, "createdAt": string }`，`createdAt` 为 ISO 8601 UTC。

错误响应统一为 `{ "error": { "code": string, "message": string } }`：

| 错误码 | HTTP | 触发条件 |
|--------|------|----------|
| `NICKNAME_REQUIRED` | 400 | 昵称 trim 后为空 |
| `NICKNAME_TOO_LONG` | 400 | 昵称超过 30 字 |
| `CONTENT_REQUIRED` | 400 | 内容 trim 后为空 |
| `CONTENT_TOO_LONG` | 400 | 内容超过 200 字 |
| `INVALID_JSON` | 400 | 请求体不是合法 JSON 对象 |
| `PAYLOAD_TOO_LARGE` | 413 | 请求体超过 8 KB |
| `NOT_FOUND` | 404 | 未知路径 |
| `METHOD_NOT_ALLOWED` | 405 | `/api/messages` 使用 GET/POST 以外方法 |
| `INTERNAL_ERROR` | 500 | 未捕获异常或存储写入失败 |

示例：

```bash
curl -s http://localhost:3000/api/messages
curl -s -X POST http://localhost:3000/api/messages \
  -H 'Content-Type: application/json' \
  -d '{"nickname":"小明","content":"你好，留言墙！"}'
```

## 数据与部署

- 留言保存在 `DATA_DIR/messages.json`（默认 `./data/messages.json`），该文件已被 `.gitignore` 忽略。
- 写入采用「临时文件 + rename」原子替换，并通过串行队列避免并发写损坏；文件损坏时会被重命名为 `messages.corrupt-<timestamp>.json` 后以空列表启动，不会静默覆盖原数据。
- 单实例 + 文件存储，不支持多副本共享；重启进程不丢数据，但删除数据目录或容器无持久卷时会丢失。
- 部署节点需支持常驻 Node 进程与自定义端口。纯静态托管（如 GitHub Pages）无法提供 `/api/messages`。
- 无鉴权、无限流、无敏感词过滤，仅适用于受控演示环境；公网暴露需另行增加网关限流与鉴权。

## 项目结构

```
.
├── server.js            # 启动装配：读取环境变量、初始化存储、监听端口、优雅退出
├── src/
│   ├── app.js           # HTTP 服务：路由、请求体限制、静态资源、错误映射、访问日志
│   ├── store.js         # JSON 文件存储：加载、倒序读取、原子写入、并发队列
│   └── validate.js      # 输入校验：trim、Unicode 码点计数、错误码
├── public/              # 静态页面（index.html / styles.css / app.js）
├── test/                # node:test 单元与接口测试
├── data/                # 运行时数据目录（messages.json 不入库）
└── docs/                # 需求 Spec、技术设计、交互原型
```
