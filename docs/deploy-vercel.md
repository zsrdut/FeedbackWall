# 留言墙 Demo · Vercel 部署说明

## 目标

把 `zsrdut/FeedbackWall` 的留言墙 Demo 部署到 Vercel，保留：

- 首页静态页面
- `GET /api/health`
- `GET /api/messages`
- `POST /api/messages`
- 前后端校验、loading、空态/错误态

## 适配方式

| 组件 | 文件 | 说明 |
|------|------|------|
| Serverless 入口 | `api/[...path].js` | Vercel 动态 API 路由，捕获 `/api/*` |
| 运行时装配 | `src/vercel.js` | 初始化 store，复用 `createRequestHandler`；默认 `DATA_DIR=/tmp/feedback-wall` |
| HTTP 路由 | `src/app.js` | `createApp` 拆出 `createRequestHandler`，本地服务与 Serverless 共用 |
| 静态资源 | `public/` | Vercel 静态托管 |
| 构建配置 | `vercel.json`、`package.json` | 无框架预设、`vercel-build` 空构建、输出目录 `public`、区域 `hkg1` |

## 环境变量

| 变量 | Vercel 默认 | 说明 |
|------|-------------|------|
| `DATA_DIR` | `/tmp/feedback-wall` | Serverless 唯一可写目录；实例级临时存储 |
| `MAX_NICKNAME_LENGTH` | `30` | 昵称上限 |
| `MAX_CONTENT_LENGTH` | `200` | 内容上限 |
| `MAX_BODY_BYTES` | `8192` | 请求体上限 |

## 部署与验证

```bash
npm test
vercel build
vercel deploy --prod
```

本地模拟：

```bash
vercel dev --listen 127.0.0.1:3100
curl -s http://127.0.0.1:3100/api/health
curl -s http://127.0.0.1:3100/api/messages
curl -s -X POST http://127.0.0.1:3100/api/messages \
  -H 'Content-Type: application/json' \
  -d '{"nickname":"验收","content":"Vercel 路由验证"}'
```

## 限制与回滚

- 数据保存在函数实例的 `/tmp`，不跨冷启动/多实例；这是 Vercel Serverless 的运行时限制。
- 需要持久化时，替换 `src/store.js` 为外部数据库/对象存储实现，接口保持 `init/list/add/flush/count` 不变。
- 公开访问受项目 Vercel Authentication 策略影响；需在控制台关闭认证或绑定自定义域名。
- 回滚：在 Vercel 控制台把 Production 指回上一部署，或执行 `vercel rollback <deployment-url>`；数据文件不在仓库内，回滚代码不影响本地数据。
