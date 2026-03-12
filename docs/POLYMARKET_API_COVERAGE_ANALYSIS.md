# Polymarket API × 当前 MCP 服务能力覆盖分析报告

- 生成时间: 2026-03-02T05:23:57.162Z
- 官方文档来源: https://docs.polymarket.com/api-reference/introduction
- Sitemap: https://docs.polymarket.com/sitemap.xml
- 官方 API 参考最近更新时间: 2026-03-02T00:16:03.090Z
- 评估口径: 能力级为主 + 双口径并行（MCP 可调用 / 内部实现）

## 背景与方法

1. 从 `sitemap.xml` 抽取全部 `api-reference/*` 页面。
2. 从 API Reference 导航抽取 17 个分类作为官方分类真值。
3. 对每个 endpoint 页面解析标题、文档链接、`spec + method + path`（若有）。
4. 扫描本地 `mcp/tools + gateway + clients + ws` 生成双口径状态。
5. 输出覆盖矩阵与分级路线图。

### 状态枚举

- `FULL`: 1:1 直接支持。
- `COMPOSITE`: 需组合调用实现。
- `INTERNAL_ONLY`: 仅内部实现，未暴露 MCP tool。
- `MISSING`: 未实现。

## 总览（17 分类）

| Category | Endpoints | MCP Callable (FULL+COMPOSITE) | Internal (FULL+COMPOSITE+INTERNAL_ONLY) |
|---|---:|---:|---:|
| Events | 4 | 4/4 (100.00%) | 4/4 (100.00%) |
| Markets | 7 | 4/7 (57.14%) | 5/7 (71.43%) |
| Orderbook & Pricing | 19 | 19/19 (100.00%) | 19/19 (100.00%) |
| Orders | 10 | 10/10 (100.00%) | 10/10 (100.00%) |
| Trades | 2 | 1/2 (50.00%) | 2/2 (100.00%) |
| CLOB Markets | 3 | 0/3 (0.00%) | 3/3 (100.00%) |
| Rebates | 1 | 0/1 (0.00%) | 0/1 (0.00%) |
| Profile | 9 | 8/9 (88.89%) | 8/9 (88.89%) |
| Leaderboard | 1 | 1/1 (100.00%) | 1/1 (100.00%) |
| Builders | 2 | 2/2 (100.00%) | 2/2 (100.00%) |
| Search | 1 | 1/1 (100.00%) | 1/1 (100.00%) |
| Tags | 7 | 7/7 (100.00%) | 7/7 (100.00%) |
| Series | 2 | 2/2 (100.00%) | 2/2 (100.00%) |
| Comments | 3 | 3/3 (100.00%) | 3/3 (100.00%) |
| Sports | 3 | 3/3 (100.00%) | 3/3 (100.00%) |
| Bridge | 5 | 5/5 (100.00%) | 5/5 (100.00%) |
| WebSocket | 3 | 3/3 (100.00%) | 3/3 (100.00%) |

- Overall MCP callable coverage: 73/82 (89.02%)
- Overall internal coverage: 78/82 (95.12%)

## 分类逐项明细

### Events

| Endpoint Name | Method/Path | MCP Callable Status | Internal Status | Evidence | Gap Note | Doc URL |
|---|---|---|---|---|---|---|
| Get event by id | GET /events/{id} | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_events_get \| internal: src/openclaw/polymarket/clients/gammaClient.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/events/get-event-by-id |
| Get event by slug | GET /events/slug/{slug} | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_events_get \| internal: src/openclaw/polymarket/clients/gammaClient.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/events/get-event-by-slug |
| Get event tags | GET /events/{id}/tags | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_events_get \| internal: src/openclaw/polymarket/clients/gammaClient.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/events/get-event-tags |
| List events | GET /events | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_events_get \| internal: src/openclaw/polymarket/clients/gammaClient.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/events/list-events |

### Markets

| Endpoint Name | Method/Path | MCP Callable Status | Internal Status | Evidence | Gap Note | Doc URL |
|---|---|---|---|---|---|---|
| Get top holders for markets | GET /holders | INTERNAL_ONLY | FULL | callable: No direct MCP tool exposure in src/openclaw/polymarket/mcp/tools.mjs \| internal: src/openclaw/polymarket/clients/dataApiClient.mjs; src/openclaw/polymarket/clients/clobService.mjs | Implemented internally but not exposed as MCP tool. | https://docs.polymarket.com/api-reference/core/get-top-holders-for-markets |
| Get market by id | GET /markets/{id} | COMPOSITE | COMPOSITE | internal: src/openclaw/polymarket/clients/gammaClient.mjs; src/openclaw/polymarket/clients/clobService.mjs | Callable via composed MCP workflow (no dedicated 1:1 tool). | https://docs.polymarket.com/api-reference/markets/get-market-by-id |
| Get market by slug | GET /markets/slug/{slug} | COMPOSITE | COMPOSITE | internal: src/openclaw/polymarket/clients/gammaClient.mjs; src/openclaw/polymarket/clients/clobService.mjs | Callable via composed MCP workflow (no dedicated 1:1 tool). | https://docs.polymarket.com/api-reference/markets/get-market-by-slug |
| Get market tags by id | GET /markets/{id}/tags | COMPOSITE | COMPOSITE | internal: src/openclaw/polymarket/clients/gammaClient.mjs; src/openclaw/polymarket/clients/clobService.mjs | Callable via composed MCP workflow (no dedicated 1:1 tool). | https://docs.polymarket.com/api-reference/markets/get-market-tags-by-id |
| List markets | GET /markets | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_market_discover \| internal: src/openclaw/polymarket/clients/gammaClient.mjs; src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/markets/list-markets |
| Get live volume for an event | GET /live-volume | MISSING | MISSING | internal: src/openclaw/polymarket/clients/dataApiClient.mjs | No implementation found in current gateway/clients. | https://docs.polymarket.com/api-reference/misc/get-live-volume-for-an-event |
| Get open interest | GET /oi | MISSING | MISSING | internal: src/openclaw/polymarket/clients/dataApiClient.mjs | No implementation found in current gateway/clients. | https://docs.polymarket.com/api-reference/misc/get-open-interest |

### Orderbook & Pricing

| Endpoint Name | Method/Path | MCP Callable Status | Internal Status | Evidence | Gap Note | Doc URL |
|---|---|---|---|---|---|---|
| Get midpoint price | GET /midpoint | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_quote_get \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/data/get-midpoint-price |
| Get server time | GET /time | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_trade_meta_get \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/data/get-server-time |
| Get fee rate | GET /fee-rate | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_quote_get \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/market-data/get-fee-rate |
| Get fee rate by path parameter | GET /fee-rate/{token_id} | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_quote_get \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/market-data/get-fee-rate-by-path-parameter |
| Get last trade price | GET /last-trade-price | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_trade_meta_get \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/market-data/get-last-trade-price |
| Get last trade prices (query parameters) | GET /last-trades-prices | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_trade_meta_get \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/market-data/get-last-trade-prices-query-parameters |
| Get last trade prices (request body) | POST /last-trades-prices | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_trade_meta_get \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/market-data/get-last-trade-prices-request-body |
| Get market price | GET /price | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_quote_get \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/market-data/get-market-price |
| Get market prices (query parameters) | GET /prices | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_market_data_batch_get \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/market-data/get-market-prices-query-parameters |
| Get market prices (request body) | POST /prices | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_market_data_batch_get \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/market-data/get-market-prices-request-body |
| Get midpoint prices (query parameters) | GET /midpoints | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_market_data_batch_get \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/market-data/get-midpoint-prices-query-parameters |
| Get midpoint prices (request body) | POST /midpoints | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_market_data_batch_get \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/market-data/get-midpoint-prices-request-body |
| Get order book | GET /book | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_quote_get \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/market-data/get-order-book |
| Get order books (request body) | POST /books | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_market_data_batch_get \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/market-data/get-order-books-request-body |
| Get spread | GET /spread | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_quote_get \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/market-data/get-spread |
| Get spreads | POST /spreads | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_market_data_batch_get \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/market-data/get-spreads |
| Get tick size | GET /tick-size | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_quote_get \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/market-data/get-tick-size |
| Get tick size by path parameter | GET /tick-size/{token_id} | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_quote_get \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/market-data/get-tick-size-by-path-parameter |
| Get prices history | GET /prices-history | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_trade_meta_get \| internal: src/openclaw/polymarket/clients/gammaClient.mjs; src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/markets/get-prices-history |

### Orders

| Endpoint Name | Method/Path | MCP Callable Status | Internal Status | Evidence | Gap Note | Doc URL |
|---|---|---|---|---|---|---|
| Cancel all orders | DELETE /cancel-all | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_order_cancel_all \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/trade/cancel-all-orders |
| Cancel multiple orders | DELETE /orders | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_order_cancel \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/trade/cancel-multiple-orders |
| Cancel orders for a market | DELETE /cancel-market-orders | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_order_cancel \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/trade/cancel-orders-for-a-market |
| Cancel single order | DELETE /order | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_order_cancel \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/trade/cancel-single-order |
| Get order scoring status | GET /order-scoring | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_trade_meta_get \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/trade/get-order-scoring-status |
| Get single order by ID | GET /order/{orderID} | COMPOSITE | FULL | internal: src/openclaw/polymarket/clients/clobService.mjs | Callable via composed MCP workflow (no dedicated 1:1 tool). | https://docs.polymarket.com/api-reference/trade/get-single-order-by-id |
| Get user orders | GET /orders | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_sync_orders \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/trade/get-user-orders |
| Post a new order | POST /order | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_order_place \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/trade/post-a-new-order |
| Post multiple orders | POST /orders | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_order_batch_place \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/trade/post-multiple-orders |
| Send heartbeat | POST /heartbeats | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_trade_meta_get \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/trade/send-heartbeat |

### Trades

| Endpoint Name | Method/Path | MCP Callable Status | Internal Status | Evidence | Gap Note | Doc URL |
|---|---|---|---|---|---|---|
| Get builder trades | GET /builder/trades | INTERNAL_ONLY | FULL | callable: No direct MCP tool exposure in src/openclaw/polymarket/mcp/tools.mjs \| internal: src/openclaw/polymarket/clients/clobService.mjs | Implemented internally but not exposed as MCP tool. | https://docs.polymarket.com/api-reference/trade/get-builder-trades |
| Get trades | GET /trades | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_sync_trades \| internal: src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/trade/get-trades |

### CLOB Markets

| Endpoint Name | Method/Path | MCP Callable Status | Internal Status | Evidence | Gap Note | Doc URL |
|---|---|---|---|---|---|---|
| Get sampling markets | GET /sampling-markets | INTERNAL_ONLY | FULL | callable: No direct MCP tool exposure in src/openclaw/polymarket/mcp/tools.mjs \| internal: src/openclaw/polymarket/clients/gammaClient.mjs; src/openclaw/polymarket/clients/clobService.mjs | Implemented internally but not exposed as MCP tool. | https://docs.polymarket.com/api-reference/markets/get-sampling-markets |
| Get sampling simplified markets | GET /sampling-simplified-markets | INTERNAL_ONLY | FULL | callable: No direct MCP tool exposure in src/openclaw/polymarket/mcp/tools.mjs \| internal: src/openclaw/polymarket/clients/gammaClient.mjs; src/openclaw/polymarket/clients/clobService.mjs | Implemented internally but not exposed as MCP tool. | https://docs.polymarket.com/api-reference/markets/get-sampling-simplified-markets |
| Get simplified markets | GET /simplified-markets | INTERNAL_ONLY | FULL | callable: No direct MCP tool exposure in src/openclaw/polymarket/mcp/tools.mjs \| internal: src/openclaw/polymarket/clients/gammaClient.mjs; src/openclaw/polymarket/clients/clobService.mjs | Implemented internally but not exposed as MCP tool. | https://docs.polymarket.com/api-reference/markets/get-simplified-markets |

### Rebates

| Endpoint Name | Method/Path | MCP Callable Status | Internal Status | Evidence | Gap Note | Doc URL |
|---|---|---|---|---|---|---|
| Get current rebated fees for a maker | GET /rebates/current | MISSING | MISSING | - | No implementation found in current gateway/clients. | https://docs.polymarket.com/api-reference/rebates/get-current-rebated-fees-for-a-maker |

### Profile

| Endpoint Name | Method/Path | MCP Callable Status | Internal Status | Evidence | Gap Note | Doc URL |
|---|---|---|---|---|---|---|
| Get closed positions for a user | GET /closed-positions | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_profile_get \| internal: src/openclaw/polymarket/clients/dataApiClient.mjs; src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/core/get-closed-positions-for-a-user |
| Get current positions for a user | GET /positions | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_sync_positions \| internal: src/openclaw/polymarket/clients/dataApiClient.mjs; src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/core/get-current-positions-for-a-user |
| Get positions for a market | GET /v1/market-positions | COMPOSITE | COMPOSITE | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_sync_positions \| internal: src/openclaw/polymarket/clients/dataApiClient.mjs; src/openclaw/polymarket/clients/clobService.mjs | Callable via composed MCP workflow (no dedicated 1:1 tool). | https://docs.polymarket.com/api-reference/core/get-positions-for-a-market |
| Get total value of a user&#x27;s positions | GET /value | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_sync_positions \| internal: src/openclaw/polymarket/clients/dataApiClient.mjs; src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/core/get-total-value-of-a-users-positions |
| Get trades for a user or markets | GET /trades | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_sync_trades; src/openclaw/polymarket/mcp/tools.mjs::pm_sync_positions \| internal: src/openclaw/polymarket/clients/dataApiClient.mjs; src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/core/get-trades-for-a-user-or-markets |
| Get user activity | GET /activity | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_sync_positions \| internal: src/openclaw/polymarket/clients/dataApiClient.mjs; src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/core/get-user-activity |
| Download an accounting snapshot (ZIP of CSVs) | GET /v1/accounting/snapshot | MISSING | MISSING | internal: src/openclaw/polymarket/clients/dataApiClient.mjs | No implementation found in current gateway/clients. | https://docs.polymarket.com/api-reference/misc/download-an-accounting-snapshot-zip-of-csvs |
| Get total markets a user has traded | GET /traded | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_profile_get \| internal: src/openclaw/polymarket/clients/dataApiClient.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/misc/get-total-markets-a-user-has-traded |
| Get public profile by wallet address | GET /public-profile | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_profile_get \| internal: src/openclaw/polymarket/clients/gammaClient.mjs; src/openclaw/polymarket/clients/dataApiClient.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/profiles/get-public-profile-by-wallet-address |

### Leaderboard

| Endpoint Name | Method/Path | MCP Callable Status | Internal Status | Evidence | Gap Note | Doc URL |
|---|---|---|---|---|---|---|
| Get trader leaderboard rankings | GET /v1/leaderboard | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_leaderboard_get \| internal: src/openclaw/polymarket/clients/dataApiClient.mjs; src/openclaw/polymarket/clients/clobService.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/core/get-trader-leaderboard-rankings |

### Builders

| Endpoint Name | Method/Path | MCP Callable Status | Internal Status | Evidence | Gap Note | Doc URL |
|---|---|---|---|---|---|---|
| Get aggregated builder leaderboard | GET /v1/builders/leaderboard | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_builder_analytics_get \| internal: src/openclaw/polymarket/clients/dataApiClient.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/builders/get-aggregated-builder-leaderboard |
| Get daily builder volume time-series | GET /v1/builders/volume | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_builder_analytics_get \| internal: src/openclaw/polymarket/clients/dataApiClient.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/builders/get-daily-builder-volume-time-series |

### Search

| Endpoint Name | Method/Path | MCP Callable Status | Internal Status | Evidence | Gap Note | Doc URL |
|---|---|---|---|---|---|---|
| Search markets, events, and profiles | GET /public-search | COMPOSITE | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_market_discover \| internal: src/openclaw/polymarket/clients/gammaClient.mjs | Callable via composed MCP workflow (no dedicated 1:1 tool). | https://docs.polymarket.com/api-reference/search/search-markets-events-and-profiles |

### Tags

| Endpoint Name | Method/Path | MCP Callable Status | Internal Status | Evidence | Gap Note | Doc URL |
|---|---|---|---|---|---|---|
| Get related tags (relationships) by tag id | GET /tags/{id}/related-tags | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_tags_get \| internal: src/openclaw/polymarket/clients/gammaClient.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/tags/get-related-tags-relationships-by-tag-id |
| Get related tags (relationships) by tag slug | GET /tags/slug/{slug}/related-tags | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_tags_get \| internal: src/openclaw/polymarket/clients/gammaClient.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/tags/get-related-tags-relationships-by-tag-slug |
| Get tag by id | GET /tags/{id} | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_tags_get \| internal: src/openclaw/polymarket/clients/gammaClient.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/tags/get-tag-by-id |
| Get tag by slug | GET /tags/slug/{slug} | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_tags_get \| internal: src/openclaw/polymarket/clients/gammaClient.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/tags/get-tag-by-slug |
| Get tags related to a tag id | GET /tags/{id}/related-tags/tags | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_tags_get \| internal: src/openclaw/polymarket/clients/gammaClient.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/tags/get-tags-related-to-a-tag-id |
| Get tags related to a tag slug | GET /tags/slug/{slug}/related-tags/tags | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_tags_get \| internal: src/openclaw/polymarket/clients/gammaClient.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/tags/get-tags-related-to-a-tag-slug |
| List tags | GET /tags | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_tags_get \| internal: src/openclaw/polymarket/clients/gammaClient.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/tags/list-tags |

### Series

| Endpoint Name | Method/Path | MCP Callable Status | Internal Status | Evidence | Gap Note | Doc URL |
|---|---|---|---|---|---|---|
| Get series by id | GET /series/{id} | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_series_get \| internal: src/openclaw/polymarket/clients/gammaClient.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/series/get-series-by-id |
| List series | GET /series | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_series_get \| internal: src/openclaw/polymarket/clients/gammaClient.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/series/list-series |

### Comments

| Endpoint Name | Method/Path | MCP Callable Status | Internal Status | Evidence | Gap Note | Doc URL |
|---|---|---|---|---|---|---|
| Get comments by comment id | GET /comments/{id} | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_comments_get \| internal: src/openclaw/polymarket/clients/gammaClient.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/comments/get-comments-by-comment-id |
| Get comments by user address | GET /comments/user_address/{user_address} | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_comments_get \| internal: src/openclaw/polymarket/clients/gammaClient.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/comments/get-comments-by-user-address |
| List comments | GET /comments | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_comments_get \| internal: src/openclaw/polymarket/clients/gammaClient.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/comments/list-comments |

### Sports

| Endpoint Name | Method/Path | MCP Callable Status | Internal Status | Evidence | Gap Note | Doc URL |
|---|---|---|---|---|---|---|
| Get sports metadata information | GET /sports | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_sports_meta_get \| internal: src/openclaw/polymarket/clients/gammaClient.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/sports/get-sports-metadata-information |
| Get valid sports market types | GET /sports/market-types | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_sports_meta_get \| internal: src/openclaw/polymarket/clients/gammaClient.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/sports/get-valid-sports-market-types |
| List teams | GET /teams | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_sports_meta_get \| internal: src/openclaw/polymarket/clients/gammaClient.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/sports/list-teams |

### Bridge

| Endpoint Name | Method/Path | MCP Callable Status | Internal Status | Evidence | Gap Note | Doc URL |
|---|---|---|---|---|---|---|
| Create deposit addresses | POST /deposit | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_bridge_deposit_create \| internal: src/openclaw/polymarket/clients/bridgeClient.mjs; src/openclaw/polymarket/polymarketGateway.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/bridge/create-deposit-addresses |
| Create withdrawal addresses | POST /withdraw | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_bridge_withdraw_create \| internal: src/openclaw/polymarket/clients/bridgeClient.mjs; src/openclaw/polymarket/polymarketGateway.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/bridge/create-withdrawal-addresses |
| Get a quote | POST /quote | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_bridge_quote_get \| internal: src/openclaw/polymarket/clients/bridgeClient.mjs; src/openclaw/polymarket/polymarketGateway.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/bridge/get-a-quote |
| Get supported assets | GET /supported-assets | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_bridge_supported_assets_get \| internal: src/openclaw/polymarket/clients/bridgeClient.mjs; src/openclaw/polymarket/polymarketGateway.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/bridge/get-supported-assets |
| Get transaction status | GET /status/{address} | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_bridge_status_get \| internal: src/openclaw/polymarket/clients/bridgeClient.mjs; src/openclaw/polymarket/polymarketGateway.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/bridge/get-transaction-status |

### WebSocket

| Endpoint Name | Method/Path | MCP Callable Status | Internal Status | Evidence | Gap Note | Doc URL |
|---|---|---|---|---|---|---|
| Market Channel | - | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_ws_subscribe; src/openclaw/polymarket/mcp/tools.mjs::pm_ws_poll; src/openclaw/polymarket/mcp/tools.mjs::pm_ws_unsubscribe \| internal: src/openclaw/polymarket/ws/channelClient.mjs; src/openclaw/polymarket/polymarketGateway.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/wss/market |
| Sports Channel | - | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_ws_subscribe; src/openclaw/polymarket/mcp/tools.mjs::pm_ws_poll; src/openclaw/polymarket/mcp/tools.mjs::pm_ws_unsubscribe \| internal: src/openclaw/polymarket/ws/channelClient.mjs; src/openclaw/polymarket/polymarketGateway.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/wss/sports |
| User Channel | - | FULL | FULL | callable: src/openclaw/polymarket/mcp/tools.mjs::pm_ws_subscribe; src/openclaw/polymarket/mcp/tools.mjs::pm_ws_poll; src/openclaw/polymarket/mcp/tools.mjs::pm_ws_unsubscribe \| internal: src/openclaw/polymarket/ws/channelClient.mjs; src/openclaw/polymarket/polymarketGateway.mjs | Directly callable via MCP tool. | https://docs.polymarket.com/api-reference/wss/user |

## 关键缺口分析

- 当前 MCP 工具面向交易主链路（下单/撤单/同步）较完整，但 **Events / Tags / Series / Comments / Sports / Bridge / WebSocket** 大量能力仍未可调用。
- `Orderbook & Pricing` 内部覆盖较高，但 `last trade price / prices history / server time` 等仍未暴露 MCP。
- `Profile` 仅覆盖当前仓位同步核心能力，`public profile / accounting snapshot / total markets traded` 仍缺失。
- `Leaderboard`、`Builders`（Data API 维度）当前未实现。

## 优先级路线图

### P0（交易闭环与实时消费）

- 新增 MCP: `pm_market_data_batch_get`（批量 prices/midpoints/spreads/orderbooks）。
- 新增 MCP: `pm_trade_meta_get`（order scoring / heartbeat / last trade / prices history / server time）。
- 新增 MCP: `pm_bridge_*`（supported-assets/quote/deposit/withdraw/status）。
- 新增 MCP: `pm_ws_subscribe`（market/user/sports 统一订阅入口）。

### P1（数据侧能力）

- 新增 MCP: `pm_profile_get`（public profile + positions/activity/value + closed positions 聚合）。
- 新增 MCP: `pm_leaderboard_get`（trader leaderboard）。
- 新增 MCP: `pm_builder_analytics_get`（aggregated leaderboard + daily volume）。

### P2（长尾与一致性）

- 新增 MCP: `pm_events_get`、`pm_tags_get`、`pm_series_get`、`pm_comments_get`、`pm_sports_meta_get`。
- 统一参数规范（`id/slug/address`）与分页结构（cursor/offset）。
- 增加“接口覆盖回归脚本”并接入 CI，自动对比 docs 变更。

## 验收检查

- 17 个分类全部存在。
- 每个分类 endpoint 数 > 0（WebSocket 为 3）。
- MCP 工具扫描计数与 `tools.mjs` 一致。
- Markdown 总览统计与 JSON 明细统计一致。

