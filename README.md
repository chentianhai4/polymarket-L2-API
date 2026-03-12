# Polymarket L2 API（OpenClaw 集成）

一个面向 Polymarket 的 Node.js 集成项目，提供：

- 可复用的交易网关 `PolymarketGateway`
- MCP stdio 服务（可被 MCP Client 直接调用）
- 本地 Web 调试台（手工调用所有 MCP 工具）
- 统一的风控、下单、同步、行情、WebSocket 会话管理能力

## 项目定位

本项目把 Polymarket 常用能力封装为统一接口，适合两类使用方式：

- 作为 **JS/TS 业务 SDK** 集成到你的策略或服务中
- 作为 **MCP Server** 暴露工具，供 Agent / MCP Client 调用

## 本次补充内容（确认）

- PolymarketGateway 主要公开 API 列表
- syncPositions 地址回退、风控模式、下单幂等与自动归一化等关键行为说明
- mcporter 依赖提示与 openclaw:demo 快速示例入口
- 常见问题排查（代理配置、鉴权失败、未确认订单、Bridge dry-run）

## 核心能力

- 鉴权与凭证：
  - L2 API Key 自动校验/恢复（create or derive）
  - 支持已有 `API_KEY/SECRET/PASSPHRASE` 直连
- 交易执行：
  - 下单前 precheck（风控 + 市场元数据检查）
  - 单笔下单、批量下单、按条件撤单、全撤
  - 下单支持 `dryRun`
  - 提交确认机制（支持同步侧证据确认，适配代理不稳定场景）
- 市场与账户数据：
  - 市场发现（Gamma）
  - 报价/盘口/点差/tick/费率/neg-risk 查询
  - 订单、成交、仓位、活动、账户价值同步
  - 排行榜、Builder 分析、Events/Tags/Series/Comments/Sports 元数据
- 资金与库存：
  - Bridge 资产、报价、状态查询
  - Bridge 充值/提现（默认 dryRun，显式开关后才允许真实写操作）
- 实时订阅：
  - `market/user/sports` WebSocket 订阅
  - 会话化轮询（`subscribe/poll/unsubscribe`）
  - 自动重连、心跳、TTL、队列上限
- 可观测性：
  - 内存指标快照
  - JSONL 审计日志（敏感字段自动脱敏）

## 目录结构（核心）

```text
.
├── bin/pm_mcp_stdio.mjs                # MCP stdio 入口
├── src/openclaw/polymarket/
│   ├── polymarketGateway.mjs            # 统一网关入口
│   ├── mcp/                             # MCP server/tools/envelope
│   ├── clients/                         # CLOB/Gamma/Data/Bridge/Relayer/Builder
│   ├── execution/                       # 下单编译与执行引擎
│   ├── risk/                            # 风控引擎
│   ├── services/                        # 市场发现/报价/仓位/库存服务
│   ├── ws/                              # WebSocket 客户端与会话管理
│   ├── observability/                   # metrics + audit logger
│   └── ui/                              # 本地调试 UI
├── examples/openclaw_gateway_demo.mjs   # SDK 调用示例
├── docker-compose.yml
└── Dockerfile
```

## 运行环境

- Node.js >= 18（建议 Node.js 20）
- npm
- 可访问 Polymarket 的网络链路（本项目通常通过代理）

## 安装

```bash
npm ci
```

## 环境变量

创建或编辑项目根目录 `.env`。

### 必填（建议）


| 变量名                 | 说明                                                            |
| ---------------------- | --------------------------------------------------------------- |
| `PRIVATE_KEY`          | 用于签名的私钥                                                  |
| `POLYMARKET_PROXY_URL` | 代理地址（本项目默认要求；也可用`HTTP_PROXY/HTTPS_PROXY` 兜底） |

### 强烈建议填写


| 变量名                              | 说明                                       |
| ----------------------------------- | ------------------------------------------ |
| `FUNDER_ADDRESS`                    | 资金地址（Proxy Wallet）                   |
| `SIGNATURE_TYPE`                    | 签名类型，常见为`2`                        |
| `API_KEY` / `SECRET` / `PASSPHRASE` | 现有 L2 凭证（不填也可在初始化时自动恢复） |

### 可选


| 变量名                          | 默认值      | 说明                                 |
| ------------------------------- | ----------- | ------------------------------------ |
| `POLYMARKET_REQUEST_TIMEOUT_MS` | `30000`     | 请求超时                             |
| `USE_SERVER_TIME`               | `true`      | 是否使用服务端时间参与签名/时序      |
| `PM_MCP_ENABLE_BRIDGE_WRITES`   | `0`         | 是否允许 Bridge 真实写操作           |
| `POLYMARKET_ENV_PATH`           | -           | 指定`.env` 路径（MCP/UI 启动时可用） |
| `UI_HOST`                       | `127.0.0.1` | UI 监听地址                          |
| `UI_PORT`                       | `17077`     | UI 监听端口                          |
| `UI_TOOL_TIMEOUT_MS`            | `30000`     | UI 调用单工具超时                    |
| `PM_UI_ENABLE_LIVE_ACTIONS`     | `0`         | UI 是否允许真实交易调用              |

示例（请替换为你自己的值）：

```dotenv
PRIVATE_KEY=0x...
FUNDER_ADDRESS=0x...
SIGNATURE_TYPE=2
API_KEY=...
SECRET=...
PASSPHRASE=...
POLYMARKET_PROXY_URL=http://127.0.0.1:10077
POLYMARKET_REQUEST_TIMEOUT_MS=30000
```

## 快速开始

### 1) 启动 MCP stdio 服务

```bash
npm run mcp:stdio
```

### 2) 命令行调用 MCP 工具（通过 `mcporter`）

```bash
npm run mcp:call -- pm_auth_bootstrap '{"autoAuth":true}'
npm run mcp:call -- pm_market_discover '{"limit":5,"active":true,"tradableOnly":true}'
npm run mcp:call -- pm_quote_get '{"tokenId":"<token-id>","side":"BUY"}'
```

> 说明：`npm run mcp:call` 依赖本机已安装 `mcporter`。

### 3) 启动本地调试 UI

```bash
npm run ui:start
```

打开：

```text
http://127.0.0.1:17077
```

### 4) 作为 SDK 使用

```js
import { PolymarketGateway } from "./index.mjs";

const gateway = new PolymarketGateway({
  privateKey: process.env.PRIVATE_KEY,
  funderAddress: process.env.FUNDER_ADDRESS,
  signatureType: Number(process.env.SIGNATURE_TYPE ?? "2"),
  apiKey: process.env.API_KEY,
  secret: process.env.SECRET,
  passphrase: process.env.PASSPHRASE,
});

await gateway.initialize({ autoAuth: true });
const markets = await gateway.discoverMarkets({ limit: 5, active: true });
console.log(markets.length);
```

也可以直接运行仓库内示例：

```bash
npm run openclaw:demo
```

## PolymarketGateway API（主要方法）

- `initialize({ autoAuth })`
- `discoverMarkets(filters)`
- `getQuote({ tokenId, side })`
- `precheckOrder(intentOrSignal, context)`
- `placeOrder(intentOrSignal, context)`
- `batchPlaceOrders(intents, options)`
- `cancel(payload)`
- `syncOrders(params)`
- `syncTrades(params)`
- `syncPositions(params)`
- `getMarketDataBatch(params)`
- `getTradeMeta(params)`
- `getProfileAggregate(params)`
- `getEvents/getTags/getSeries/getComments/getSportsMeta`
- `connectMarketStream/connectUserStream/connectSportsStream`
- `disconnectWsStream/disconnectStreams`
- `metricsSnapshot()`

## MCP 工具清单（32 个）

### 鉴权

- `pm_auth_bootstrap`
- `pm_auth_validate`

### 市场与数据

- `pm_market_discover`
- `pm_quote_get`
- `pm_market_data_batch_get`
- `pm_trade_meta_get`
- `pm_profile_get`
- `pm_leaderboard_get`
- `pm_builder_analytics_get`
- `pm_events_get`
- `pm_tags_get`
- `pm_series_get`
- `pm_comments_get`
- `pm_sports_meta_get`
- `pm_balance_get`

### 交易与同步

- `pm_precheck_order`
- `pm_order_place`
- `pm_order_batch_place`
- `pm_order_cancel`
- `pm_order_cancel_all`
- `pm_sync_orders`
- `pm_sync_trades`
- `pm_sync_positions`

### Bridge

- `pm_bridge_supported_assets_get`
- `pm_bridge_quote_get`
- `pm_bridge_status_get`
- `pm_bridge_deposit_create`
- `pm_bridge_withdraw_create`

### WebSocket 与观测

- `pm_ws_subscribe`
- `pm_ws_poll`
- `pm_ws_unsubscribe`
- `pm_metrics_snapshot`

## 典型交易调用链路

建议顺序：

1. `pm_auth_bootstrap`
2. `pm_market_discover` / `pm_quote_get`
3. `pm_precheck_order`
4. `pm_order_place`（先 `dryRun: true`）
5. `pm_sync_orders` / `pm_sync_trades` / `pm_sync_positions`

`pm_order_place` 示例（推荐先 dry-run）：

```json
{
  "intent": {
    "tokenId": "<token-id>",
    "side": "BUY",
    "orderType": "LIMIT",
    "size": 1,
    "limitPrice": 0.5,
    "timeInForce": "GTC",
    "postOnly": true
  },
  "context": {
    "skillId": "manual",
    "countryCode": "SG",
    "idempotencyKey": "manual:<token-id>:buy"
  },
  "dryRun": true
}
```

## 关键行为说明

- `syncPositions` 默认会在“请求地址无仓位/活动/价值”时回退到 `FUNDER_ADDRESS` 再查询（可通过 `useFunderFallback=false` 关闭）。
- 风控默认 `warn-only`：`SOFT_BLOCK` 可继续执行、`HARD_BLOCK` 会拦截下单。
- 执行引擎会做市场元数据归一化（`tickSize/minOrderSize/盘口边界`），并在必要时自动调整价格与数量。
- 下单支持 `idempotencyKey` 去重，避免重复执行。
- Bridge 写操作默认禁用，且 UI 默认会将交易类工具强制为 `dryRun`。

## 返回格式（MCP Envelope）

成功：

```json
{
  "ok": true,
  "traceId": "...",
  "data": {},
  "warnings": []
}
```

失败：

```json
{
  "ok": false,
  "traceId": "...",
  "error": {
    "code": "RISK_HARD_BLOCK",
    "message": "...",
    "details": {}
  }
}
```

常见错误码：

- `AUTH_INVALID_KEY`
- `RISK_HARD_BLOCK`
- `RISK_SOFT_BLOCK`
- `ORDER_REJECTED`
- `ORDER_SUBMISSION_UNCONFIRMED`
- `RATE_LIMITED`
- `UPSTREAM_UNAVAILABLE`
- `VALIDATION_FAILED`

## Docker 运行

构建并启动 MCP 服务：

```bash
npm run docker:build
npm run docker:up
```

启动 UI：

```bash
npm run docker:ui
```

说明：

- 容器入口会通过 `socat` 将容器内 `127.0.0.1:10077` 转发到宿主机代理。
- 如需更换基础镜像可设置 `BASE_IMAGE` 构建参数。

## 常见问题

1. 启动时报 `POLYMARKET_PROXY_URL is required`
   - 需要在 `.env` 中设置 `POLYMARKET_PROXY_URL`，或设置 `HTTP_PROXY/HTTPS_PROXY`。
2. `pm_auth_validate` 返回鉴权失败
   - 检查 `PRIVATE_KEY` 与 `API_KEY/SECRET/PASSPHRASE` 是否匹配；可先执行 `pm_auth_bootstrap` 自动恢复。
3. 交易工具返回 `ORDER_SUBMISSION_UNCONFIRMED`
   - 常见于代理网络抖动，建议先 `pm_sync_orders` / `pm_sync_trades` 核对，再使用新的 `idempotencyKey` 重试。
4. Bridge 充值/提现始终是 dry-run
   - MCP 需要 `PM_MCP_ENABLE_BRIDGE_WRITES=1` 且请求参数 `dryRun=false`；UI 还需要 `PM_UI_ENABLE_LIVE_ACTIONS=1` 并手动勾选允许真实调用。

## 安全说明

- 不要提交 `.env`、私钥、L2 凭证。
- 审计日志路径：`./audit/polymarket-audit.log`（会自动脱敏 `privateKey/secret/passphrase/apiKey/signature/Authorization` 等字段）。
- Bridge 真实写操作默认关闭，需显式开启：
  - MCP：`PM_MCP_ENABLE_BRIDGE_WRITES=1` 且请求 `dryRun=false`
  - UI：`PM_UI_ENABLE_LIVE_ACTIONS=1` 且前端勾选允许真实调用

## License

Apache License 2.0
