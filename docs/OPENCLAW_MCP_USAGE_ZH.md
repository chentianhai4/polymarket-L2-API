# OpenClaw × Polymarket MCP 使用文档（第一阶段）

## 1. 功能范围

当前 MCP 服务已开放以下工具（14 个）：

- `pm_auth_bootstrap`
- `pm_auth_validate`
- `pm_market_discover`
- `pm_quote_get`
- `pm_balance_get`
- `pm_precheck_order`
- `pm_order_place`
- `pm_order_batch_place`
- `pm_order_cancel`
- `pm_order_cancel_all`
- `pm_sync_orders`
- `pm_sync_trades`
- `pm_sync_positions`
- `pm_metrics_snapshot`

说明：Builder/Relayer/Bridge/CTF 执行能力属于第二阶段，第一阶段不暴露执行类工具。

## 2. 环境准备

在项目根目录 `.env` 配置至少以下变量：

```dotenv
PRIVATE_KEY=0x...
FUNDER_ADDRESS=0x...
SIGNATURE_TYPE=2
API_KEY=...
SECRET=...
PASSPHRASE=...
POLYMARKET_PROXY_URL=http://127.0.0.1:10077
```

可选（实盘 smoke 测试用）：

```dotenv
LIVE_TRADING=1
MAX_TEST_NOTIONAL_USD=5
```

可选（覆盖默认超时）：

```dotenv
POLYMARKET_REQUEST_TIMEOUT_MS=30000
```

说明：

- MCP 服务启动时会强制检查 `POLYMARKET_PROXY_URL`，未配置会直接失败（fail-fast）。
- MCP 调用与 HTTP 请求默认超时均为 `30000ms`。

## 3. 启动 MCP（stdio）

```bash
npm run mcp:stdio
```

或直接：

```bash
node ./bin/pm_mcp_stdio.mjs
```

## 4. 通过 mcporter 调用

### 4.1 包装脚本调用

```bash
bash ./scripts/pm_mcp_call.sh pm_metrics_snapshot '{}'
bash ./scripts/pm_mcp_call.sh pm_quote_get '{"tokenId":"<token-id>","side":"BUY"}'
```

说明：`scripts/pm_mcp_call.sh` 默认会把 `MCPORTER_CALL_TIMEOUT` 设为 `30000ms`，可通过环境变量覆盖。

### 4.2 直接调用 stdio server

```bash
mcporter call --stdio "node /Users/wangchenxiong/Desktop/polymarket L2 API/bin/pm_mcp_stdio.mjs" pm_market_discover --args '{"limit":5,"active":true}'
```

## 5. 推荐执行链路

1. `pm_auth_bootstrap`
2. `pm_market_discover`
3. `pm_quote_get`
4. `pm_precheck_order`
5. `pm_order_place`（建议先 `dryRun=true`）
6. `pm_order_cancel`（建议先 `dryRun=true`）
7. `pm_sync_orders / pm_sync_trades / pm_sync_positions`

交易类 dry-run 示例（无真实交易副作用）：

```bash
bash ./scripts/pm_mcp_call.sh pm_order_place '{"intent":{"tokenId":"<token-id>","side":"BUY","orderType":"LIMIT","size":1,"limitPrice":0.5,"timeInForce":"GTC","postOnly":true},"dryRun":true}'
bash ./scripts/pm_mcp_call.sh pm_order_batch_place '{"intents":[{"tokenId":"<token-id>","side":"BUY","orderType":"LIMIT","size":1,"limitPrice":0.5,"timeInForce":"GTC","postOnly":true}],"dryRun":true}'
bash ./scripts/pm_mcp_call.sh pm_order_cancel '{"payload":{"all":true},"dryRun":true}'
bash ./scripts/pm_mcp_call.sh pm_order_cancel_all '{"dryRun":true}'
```

`pm_sync_positions` 默认仅同步 Data API（`positions/activity/value`），不会强依赖 CLOB。
并且默认会在“请求地址为空仓”时自动回退到 `FUNDER_ADDRESS`（proxy wallet）。
如需把 CLOB 子项一起同步，可在 `params` 里显式开启：

```json
{
  "address": "0x...",
  "includeOpenOrders": true,
  "includeClobTrades": true,
  "includeNotifications": true,
  "useFunderFallback": true
}
```

如果你明确只想查询传入地址，不做 proxy 回退：

```json
{
  "address": "0x...",
  "useFunderFallback": false
}
```

## 6. 返回结构

成功：

```json
{
  "ok": true,
  "data": {},
  "traceId": "...",
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

错误码：

- `AUTH_INVALID_KEY`
- `RISK_HARD_BLOCK`
- `RISK_SOFT_BLOCK`
- `ORDER_REJECTED`
- `RATE_LIMITED`
- `UPSTREAM_UNAVAILABLE`
- `VALIDATION_FAILED`

## 7. 风控策略

默认为 `warn-only`：

- `SOFT_BLOCK` -> `effectiveAction=CONTINUE`，允许继续执行并返回 `warnings`
- `HARD_BLOCK` -> `effectiveAction=BLOCK`，禁止下单

## 8. 测试命令

```bash
npm test
npm run test:live
npm run mcp:validate
```

`test:live` 仅在 `LIVE_TRADING=1` 时执行真实小额下单测试。
`mcp:validate` 会自动调用 14 个 MCP 工具并覆盖生成 `MCP_TOOL_VALIDATION.md`，其中交易类工具固定 `dryRun=true`。

## 9. 常见网络问题（403/超时）

1. 若你本机直连访问 Polymarket 为 `403` 或 MCP 调用超时，先在 `.env` 加：
`POLYMARKET_PROXY_URL=http://127.0.0.1:10077`
2. 用以下命令验证：
`bash ./scripts/pm_mcp_call.sh pm_auth_validate '{"recover":false}'`
3. 期望返回：
- `valid=true`：代理链路可用，凭证可用
- `valid=false`：代理链路可达但凭证无效/未生效
4. 再验证余额：
`bash ./scripts/pm_mcp_call.sh pm_balance_get '{"assetType":"COLLATERAL","updateFirst":true}'`

## 10. Docker 容器化运行（含代理 127.0.0.1:10077）

已提供：

- `Dockerfile`
- `docker-compose.yml`
- `docker/entrypoint.sh`

关键行为：

- 容器内固定使用 `POLYMARKET_PROXY_URL=http://127.0.0.1:10077`
- 入口脚本会在容器里启动 `socat`，把容器内 `127.0.0.1:10077` 转发到宿主机 `host.docker.internal:10077`
- `.env` 通过 `docker-compose.yml` 的 `env_file` 注入生效

命令：

```bash
npm run docker:build
npm run docker:up
```

如果你希望强制使用官方 Node 基础镜像，可覆盖构建参数：

```bash
BASE_IMAGE=node:20-bookworm-slim npm run docker:build
```

在容器内跑验证（会覆盖生成 `MCP_TOOL_VALIDATION.md`）：

```bash
npm run docker:validate
```

如果你希望用容器执行一次工具调用（示例）：

```bash
docker compose run --rm polymarket-mcp bash -lc "npm run mcp:validate"
```

## 11. 手工联调前端页面（14 个工具全覆盖）

宿主机启动：

```bash
npm run ui:start
```

打开浏览器：

```text
http://127.0.0.1:17077
```

页面能力：

- 顶部健康状态、代理值、模式显示
- `.env` 关键变量明文回显（本机调试模式）
- 14 个 MCP 工具逐个按钮执行
- 一键 `Run All` 顺序调用 14 个工具
- 交易类工具默认 `dryRun=true`，勾选“允许真实交易调用”并配置 `PM_UI_ENABLE_LIVE_ACTIONS=1` 后可真实执行
- 会话历史（内存）记录请求与响应

容器启动 UI：

```bash
npm run docker:ui
```

说明：

- `polymarket-ui` 服务映射 `127.0.0.1:17077:17077`
- 容器内代理仍固定走 `127.0.0.1:10077`，由 entrypoint 转发到宿主机代理
