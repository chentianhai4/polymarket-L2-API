# Polymarket L2 API (OpenClaw Integration)

A Node.js integration project for Polymarket that provides:

- A reusable trading gateway: `PolymarketGateway`
- MCP stdio service (callable by MCP clients)
- Local web debug console (manual execution for all MCP tools)
- Unified risk control, order execution, sync, market data, and WebSocket session management

## Project Positioning

This project encapsulates commonly used Polymarket capabilities behind a single interface and supports two main usage patterns:

- Integrate as a **JS/TS SDK** in your strategy/service
- Run as an **MCP server** for agent/tool calling

## Latest Additions (Confirmed)

- Public API list for `PolymarketGateway`
- Key behavior notes for `syncPositions` fallback, risk mode, idempotency, and auto-normalization
- `mcporter` dependency note and `openclaw:demo` quick entry
- Troubleshooting section (proxy setup, auth failure, unconfirmed submission, Bridge dry-run)

## Core Capabilities

- Authentication and credentials:
  - Automatic L2 API credential validation/recovery (create or derive)
  - Supports direct use of existing `API_KEY/SECRET/PASSPHRASE`
- Trading execution:
  - Pre-check before placing orders (risk + market metadata checks)
  - Single order, batch order, conditional cancel, cancel all
  - `dryRun` support
  - Submission confirmation mechanism (sync-side evidence fallback for unstable proxy networks)
- Market and account data:
  - Market discovery (Gamma)
  - Price/orderbook/spread/tick/fee-rate/neg-risk queries
  - Order/trade/position/activity/account-value synchronization
  - Leaderboard, builder analytics, events/tags/series/comments/sports metadata
- Funds and inventory:
  - Bridge assets, quotes, and status queries
  - Bridge deposit/withdraw (dry-run by default; live write requires explicit enablement)
- Realtime subscriptions:
  - `market/user/sports` WebSocket subscriptions
  - Session-based polling (`subscribe/poll/unsubscribe`)
  - Auto reconnect, heartbeat, TTL, queue limits
- Observability:
  - In-memory metrics snapshot
  - JSONL audit logs with secret redaction

## Core Structure

```text
.
├── bin/pm_mcp_stdio.mjs                # MCP stdio entry
├── src/openclaw/polymarket/
│   ├── polymarketGateway.mjs            # Unified gateway entry
│   ├── mcp/                             # MCP server/tools/envelope
│   ├── clients/                         # CLOB/Gamma/Data/Bridge/Relayer/Builder
│   ├── execution/                       # Intent compiler + execution engine
│   ├── risk/                            # Risk engine
│   ├── services/                        # Discovery/quote/position/inventory services
│   ├── ws/                              # WebSocket client + session manager
│   ├── observability/                   # metrics + audit logger
│   └── ui/                              # Local debug UI
├── examples/openclaw_gateway_demo.mjs   # SDK example
├── docker-compose.yml
└── Dockerfile
```

## Requirements

- Node.js >= 18 (Node.js 20 recommended)
- npm
- Network path that can access Polymarket (typically via proxy in this project)

## Installation

```bash
npm ci
```

## Environment Variables

Create/edit `.env` in project root.

### Required (recommended)

| Variable | Description |
| --- | --- |
| `PRIVATE_KEY` | Signer private key |
| `POLYMARKET_PROXY_URL` | Proxy URL (project defaults rely on this; `HTTP_PROXY/HTTPS_PROXY` can be fallback) |

### Strongly Recommended

| Variable | Description |
| --- | --- |
| `FUNDER_ADDRESS` | Funder / proxy wallet address |
| `SIGNATURE_TYPE` | Signature type, commonly `2` |
| `API_KEY` / `SECRET` / `PASSPHRASE` | Existing L2 credentials (optional if auto-recovery is used) |

### Optional

| Variable | Default | Description |
| --- | --- | --- |
| `POLYMARKET_REQUEST_TIMEOUT_MS` | `30000` | Request timeout |
| `USE_SERVER_TIME` | `true` | Whether to use server time for signing/timing |
| `PM_MCP_ENABLE_BRIDGE_WRITES` | `0` | Enable live Bridge write operations |
| `POLYMARKET_ENV_PATH` | - | Custom `.env` path for MCP/UI |
| `UI_HOST` | `127.0.0.1` | UI host |
| `UI_PORT` | `17077` | UI port |
| `UI_TOOL_TIMEOUT_MS` | `30000` | Per-tool timeout in UI |
| `PM_UI_ENABLE_LIVE_ACTIONS` | `0` | Allow live trading actions from UI |

Example:

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

## Quick Start

### 1) Start MCP stdio service

```bash
npm run mcp:stdio
```

### 2) Call MCP tools from command line (via `mcporter`)

```bash
npm run mcp:call -- pm_auth_bootstrap '{"autoAuth":true}'
npm run mcp:call -- pm_market_discover '{"limit":5,"active":true,"tradableOnly":true}'
npm run mcp:call -- pm_quote_get '{"tokenId":"<token-id>","side":"BUY"}'
```

> Note: `npm run mcp:call` requires `mcporter` installed on your machine.

### 3) Start local debug UI

```bash
npm run ui:start
```

Open:

```text
http://127.0.0.1:17077
```

### 4) Use as SDK

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

You can also run the built-in demo:

```bash
npm run openclaw:demo
```

## PolymarketGateway API (Main Methods)

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

## MCP Tool List (32)

### Auth

- `pm_auth_bootstrap`
- `pm_auth_validate`

### Market and Data

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

### Trading and Sync

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

### WebSocket and Observability

- `pm_ws_subscribe`
- `pm_ws_poll`
- `pm_ws_unsubscribe`
- `pm_metrics_snapshot`

## Typical Trading Flow

Recommended sequence:

1. `pm_auth_bootstrap`
2. `pm_market_discover` / `pm_quote_get`
3. `pm_precheck_order`
4. `pm_order_place` (start with `dryRun: true`)
5. `pm_sync_orders` / `pm_sync_trades` / `pm_sync_positions`

`pm_order_place` example (dry-run first):

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

## Key Behavior Notes

- `syncPositions` defaults to fallback query using `FUNDER_ADDRESS` when the requested address returns empty portfolio/activity/value (disable via `useFunderFallback=false`).
- Risk mode defaults to `warn-only`: `SOFT_BLOCK` can continue, `HARD_BLOCK` blocks order placement.
- Execution engine normalizes market constraints (`tickSize/minOrderSize/book-edge`) and may auto-adjust size/price when needed.
- Order placement supports `idempotencyKey` to avoid duplicate execution.
- Bridge write operations are disabled by default, and UI trading tools are forced to `dryRun` unless explicitly enabled.

## MCP Envelope Format

Success:

```json
{
  "ok": true,
  "traceId": "...",
  "data": {},
  "warnings": []
}
```

Error:

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

Common error codes:

- `AUTH_INVALID_KEY`
- `RISK_HARD_BLOCK`
- `RISK_SOFT_BLOCK`
- `ORDER_REJECTED`
- `ORDER_SUBMISSION_UNCONFIRMED`
- `RATE_LIMITED`
- `UPSTREAM_UNAVAILABLE`
- `VALIDATION_FAILED`

## Docker

Build and run MCP service:

```bash
npm run docker:build
npm run docker:up
```

Run UI:

```bash
npm run docker:ui
```

Notes:

- Entrypoint uses `socat` to forward container `127.0.0.1:10077` to host proxy.
- You can override base image with `BASE_IMAGE` build arg.

## Troubleshooting

1. Startup error: `POLYMARKET_PROXY_URL is required`
   - Set `POLYMARKET_PROXY_URL` in `.env`, or provide `HTTP_PROXY/HTTPS_PROXY`.
2. `pm_auth_validate` fails
   - Verify `PRIVATE_KEY` and `API_KEY/SECRET/PASSPHRASE` match; try `pm_auth_bootstrap` for recovery.
3. `ORDER_SUBMISSION_UNCONFIRMED`
   - Common in unstable proxy networks. Run `pm_sync_orders` / `pm_sync_trades`, then retry with a fresh `idempotencyKey`.
4. Bridge deposit/withdraw always dry-run
   - MCP needs `PM_MCP_ENABLE_BRIDGE_WRITES=1` and `dryRun=false`; UI also needs `PM_UI_ENABLE_LIVE_ACTIONS=1` and manual live toggle.

## Security Notes

- Never commit `.env`, private keys, or L2 credentials.
- Audit log path: `./audit/polymarket-audit.log` (auto-redacts sensitive fields such as `privateKey`, `secret`, `passphrase`, `apiKey`, `signature`, `Authorization`).
- Bridge live writes are off by default and must be explicitly enabled:
  - MCP: `PM_MCP_ENABLE_BRIDGE_WRITES=1` and request with `dryRun=false`
  - UI: `PM_UI_ENABLE_LIVE_ACTIONS=1` and enable live mode in the UI

## License

Apache License 2.0
