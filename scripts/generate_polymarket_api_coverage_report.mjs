#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import https from "node:https";

const DOCS_HOST = "https://docs.polymarket.com";
const SITEMAP_URL = `${DOCS_HOST}/sitemap.xml`;
const INTRO_URL = `${DOCS_HOST}/api-reference/introduction`;

const TARGET_CATEGORIES = [
  "Events",
  "Markets",
  "Orderbook & Pricing",
  "Orders",
  "Trades",
  "CLOB Markets",
  "Rebates",
  "Profile",
  "Leaderboard",
  "Builders",
  "Search",
  "Tags",
  "Series",
  "Comments",
  "Sports",
  "Bridge",
  "WebSocket",
];

const CALLABLE_FULL = new Set([
  "api-reference/events/get-event-by-id",
  "api-reference/events/get-event-by-slug",
  "api-reference/events/get-event-tags",
  "api-reference/events/list-events",
  "api-reference/markets/list-markets",
  "api-reference/market-data/get-order-book",
  "api-reference/market-data/get-order-books-request-body",
  "api-reference/market-data/get-market-price",
  "api-reference/market-data/get-market-prices-query-parameters",
  "api-reference/market-data/get-market-prices-request-body",
  "api-reference/data/get-midpoint-price",
  "api-reference/market-data/get-midpoint-prices-query-parameters",
  "api-reference/market-data/get-midpoint-prices-request-body",
  "api-reference/market-data/get-spread",
  "api-reference/market-data/get-spreads",
  "api-reference/market-data/get-last-trade-price",
  "api-reference/market-data/get-last-trade-prices-query-parameters",
  "api-reference/market-data/get-last-trade-prices-request-body",
  "api-reference/data/get-server-time",
  "api-reference/markets/get-prices-history",
  "api-reference/market-data/get-fee-rate",
  "api-reference/market-data/get-fee-rate-by-path-parameter",
  "api-reference/market-data/get-tick-size",
  "api-reference/market-data/get-tick-size-by-path-parameter",
  "api-reference/trade/post-a-new-order",
  "api-reference/trade/post-multiple-orders",
  "api-reference/trade/get-user-orders",
  "api-reference/trade/cancel-single-order",
  "api-reference/trade/cancel-multiple-orders",
  "api-reference/trade/cancel-all-orders",
  "api-reference/trade/cancel-orders-for-a-market",
  "api-reference/trade/get-order-scoring-status",
  "api-reference/trade/send-heartbeat",
  "api-reference/trade/get-trades",
  "api-reference/core/get-current-positions-for-a-user",
  "api-reference/core/get-closed-positions-for-a-user",
  "api-reference/core/get-user-activity",
  "api-reference/core/get-total-value-of-a-users-positions",
  "api-reference/core/get-trades-for-a-user-or-markets",
  "api-reference/profiles/get-public-profile-by-wallet-address",
  "api-reference/misc/get-total-markets-a-user-has-traded",
  "api-reference/core/get-trader-leaderboard-rankings",
  "api-reference/builders/get-aggregated-builder-leaderboard",
  "api-reference/builders/get-daily-builder-volume-time-series",
  "api-reference/tags/list-tags",
  "api-reference/tags/get-tag-by-id",
  "api-reference/tags/get-tag-by-slug",
  "api-reference/tags/get-related-tags-relationships-by-tag-id",
  "api-reference/tags/get-related-tags-relationships-by-tag-slug",
  "api-reference/tags/get-tags-related-to-a-tag-id",
  "api-reference/tags/get-tags-related-to-a-tag-slug",
  "api-reference/series/list-series",
  "api-reference/series/get-series-by-id",
  "api-reference/comments/list-comments",
  "api-reference/comments/get-comments-by-comment-id",
  "api-reference/comments/get-comments-by-user-address",
  "api-reference/sports/get-sports-metadata-information",
  "api-reference/sports/get-valid-sports-market-types",
  "api-reference/sports/list-teams",
  "api-reference/bridge/get-supported-assets",
  "api-reference/bridge/get-a-quote",
  "api-reference/bridge/get-transaction-status",
  "api-reference/bridge/create-deposit-addresses",
  "api-reference/bridge/create-withdrawal-addresses",
  "api-reference/wss/market",
  "api-reference/wss/user",
  "api-reference/wss/sports",
]);

const CALLABLE_COMPOSITE = new Set([
  "api-reference/markets/get-market-by-id",
  "api-reference/markets/get-market-by-slug",
  "api-reference/markets/get-market-tags-by-id",
  "api-reference/search/search-markets-events-and-profiles",
  "api-reference/trade/get-single-order-by-id",
  "api-reference/core/get-positions-for-a-market",
]);

const INTERNAL_FULL = new Set([
  "api-reference/events/get-event-by-id",
  "api-reference/events/get-event-by-slug",
  "api-reference/events/get-event-tags",
  "api-reference/events/list-events",
  "api-reference/markets/list-markets",
  "api-reference/markets/get-prices-history",
  "api-reference/core/get-top-holders-for-markets",
  "api-reference/market-data/get-order-book",
  "api-reference/market-data/get-order-books-request-body",
  "api-reference/market-data/get-market-price",
  "api-reference/market-data/get-market-prices-query-parameters",
  "api-reference/market-data/get-market-prices-request-body",
  "api-reference/data/get-midpoint-price",
  "api-reference/market-data/get-midpoint-prices-query-parameters",
  "api-reference/market-data/get-midpoint-prices-request-body",
  "api-reference/market-data/get-spread",
  "api-reference/market-data/get-spreads",
  "api-reference/market-data/get-last-trade-price",
  "api-reference/market-data/get-last-trade-prices-query-parameters",
  "api-reference/market-data/get-last-trade-prices-request-body",
  "api-reference/market-data/get-fee-rate",
  "api-reference/market-data/get-fee-rate-by-path-parameter",
  "api-reference/market-data/get-tick-size",
  "api-reference/market-data/get-tick-size-by-path-parameter",
  "api-reference/data/get-server-time",
  "api-reference/trade/post-a-new-order",
  "api-reference/trade/cancel-single-order",
  "api-reference/trade/get-single-order-by-id",
  "api-reference/trade/post-multiple-orders",
  "api-reference/trade/get-user-orders",
  "api-reference/trade/cancel-multiple-orders",
  "api-reference/trade/cancel-all-orders",
  "api-reference/trade/cancel-orders-for-a-market",
  "api-reference/trade/get-order-scoring-status",
  "api-reference/trade/send-heartbeat",
  "api-reference/trade/get-trades",
  "api-reference/trade/get-builder-trades",
  "api-reference/markets/get-simplified-markets",
  "api-reference/markets/get-sampling-markets",
  "api-reference/markets/get-sampling-simplified-markets",
  "api-reference/core/get-current-positions-for-a-user",
  "api-reference/core/get-closed-positions-for-a-user",
  "api-reference/core/get-user-activity",
  "api-reference/core/get-total-value-of-a-users-positions",
  "api-reference/core/get-trades-for-a-user-or-markets",
  "api-reference/misc/get-total-markets-a-user-has-traded",
  "api-reference/profiles/get-public-profile-by-wallet-address",
  "api-reference/core/get-trader-leaderboard-rankings",
  "api-reference/builders/get-aggregated-builder-leaderboard",
  "api-reference/builders/get-daily-builder-volume-time-series",
  "api-reference/search/search-markets-events-and-profiles",
  "api-reference/tags/list-tags",
  "api-reference/tags/get-tag-by-id",
  "api-reference/tags/get-tag-by-slug",
  "api-reference/tags/get-related-tags-relationships-by-tag-id",
  "api-reference/tags/get-related-tags-relationships-by-tag-slug",
  "api-reference/tags/get-tags-related-to-a-tag-id",
  "api-reference/tags/get-tags-related-to-a-tag-slug",
  "api-reference/series/list-series",
  "api-reference/series/get-series-by-id",
  "api-reference/comments/list-comments",
  "api-reference/comments/get-comments-by-comment-id",
  "api-reference/comments/get-comments-by-user-address",
  "api-reference/sports/get-sports-metadata-information",
  "api-reference/sports/get-valid-sports-market-types",
  "api-reference/sports/list-teams",
  "api-reference/bridge/get-supported-assets",
  "api-reference/bridge/create-deposit-addresses",
  "api-reference/bridge/get-a-quote",
  "api-reference/bridge/get-transaction-status",
  "api-reference/bridge/create-withdrawal-addresses",
  "api-reference/wss/market",
  "api-reference/wss/user",
  "api-reference/wss/sports",
]);

const INTERNAL_COMPOSITE = new Set([
  "api-reference/markets/get-market-by-id",
  "api-reference/markets/get-market-by-slug",
  "api-reference/markets/get-market-tags-by-id",
  "api-reference/core/get-positions-for-a-market",
]);

const EVIDENCE = {
  mcpMarketDiscover: "src/openclaw/polymarket/mcp/tools.mjs::pm_market_discover",
  mcpQuoteGet: "src/openclaw/polymarket/mcp/tools.mjs::pm_quote_get",
  mcpMarketDataBatchGet: "src/openclaw/polymarket/mcp/tools.mjs::pm_market_data_batch_get",
  mcpTradeMetaGet: "src/openclaw/polymarket/mcp/tools.mjs::pm_trade_meta_get",
  mcpBridgeSupportedAssets: "src/openclaw/polymarket/mcp/tools.mjs::pm_bridge_supported_assets_get",
  mcpBridgeQuote: "src/openclaw/polymarket/mcp/tools.mjs::pm_bridge_quote_get",
  mcpBridgeStatus: "src/openclaw/polymarket/mcp/tools.mjs::pm_bridge_status_get",
  mcpBridgeDeposit: "src/openclaw/polymarket/mcp/tools.mjs::pm_bridge_deposit_create",
  mcpBridgeWithdraw: "src/openclaw/polymarket/mcp/tools.mjs::pm_bridge_withdraw_create",
  mcpProfileGet: "src/openclaw/polymarket/mcp/tools.mjs::pm_profile_get",
  mcpLeaderboardGet: "src/openclaw/polymarket/mcp/tools.mjs::pm_leaderboard_get",
  mcpBuilderAnalyticsGet: "src/openclaw/polymarket/mcp/tools.mjs::pm_builder_analytics_get",
  mcpEventsGet: "src/openclaw/polymarket/mcp/tools.mjs::pm_events_get",
  mcpTagsGet: "src/openclaw/polymarket/mcp/tools.mjs::pm_tags_get",
  mcpSeriesGet: "src/openclaw/polymarket/mcp/tools.mjs::pm_series_get",
  mcpCommentsGet: "src/openclaw/polymarket/mcp/tools.mjs::pm_comments_get",
  mcpSportsMetaGet: "src/openclaw/polymarket/mcp/tools.mjs::pm_sports_meta_get",
  mcpWsSubscribe: "src/openclaw/polymarket/mcp/tools.mjs::pm_ws_subscribe",
  mcpWsPoll: "src/openclaw/polymarket/mcp/tools.mjs::pm_ws_poll",
  mcpWsUnsubscribe: "src/openclaw/polymarket/mcp/tools.mjs::pm_ws_unsubscribe",
  mcpOrderPlace: "src/openclaw/polymarket/mcp/tools.mjs::pm_order_place",
  mcpOrderBatchPlace: "src/openclaw/polymarket/mcp/tools.mjs::pm_order_batch_place",
  mcpOrderCancel: "src/openclaw/polymarket/mcp/tools.mjs::pm_order_cancel",
  mcpOrderCancelAll: "src/openclaw/polymarket/mcp/tools.mjs::pm_order_cancel_all",
  mcpSyncOrders: "src/openclaw/polymarket/mcp/tools.mjs::pm_sync_orders",
  mcpSyncTrades: "src/openclaw/polymarket/mcp/tools.mjs::pm_sync_trades",
  mcpSyncPositions: "src/openclaw/polymarket/mcp/tools.mjs::pm_sync_positions",
  gammaClient: "src/openclaw/polymarket/clients/gammaClient.mjs",
  dataApiClient: "src/openclaw/polymarket/clients/dataApiClient.mjs",
  clobService: "src/openclaw/polymarket/clients/clobService.mjs",
  bridgeClient: "src/openclaw/polymarket/clients/bridgeClient.mjs",
  gateway: "src/openclaw/polymarket/polymarketGateway.mjs",
  wsClient: "src/openclaw/polymarket/ws/channelClient.mjs",
};

function assertOk(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function pct(num, den) {
  if (!den) return "0.00%";
  return `${((num / den) * 100).toFixed(2)}%`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fetchText(url, redirects = 0) {
  if (redirects > 5) {
    throw new Error(`Too many redirects while fetching ${url}`);
  }

  const parsed = new URL(url);
  const client = parsed.protocol === "http:" ? http : https;

  return await new Promise((resolve, reject) => {
    const req = client.request(
      parsed,
      {
        method: "GET",
        headers: {
          "User-Agent": "polymarket-l2-api-coverage-script/1.0",
          Accept: "text/html,application/xml,text/plain,*/*",
        },
        timeout: 20000,
      },
      (res) => {
        const status = Number(res.statusCode ?? 0);
        const location = res.headers.location;

        if (status >= 300 && status < 400 && location) {
          const nextUrl = new URL(location, parsed).toString();
          res.resume();
          fetchText(nextUrl, redirects + 1).then(resolve).catch(reject);
          return;
        }

        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`Failed to fetch ${url}: ${status}`));
          return;
        }

        const chunks = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      },
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error(`Request timeout while fetching ${url}`));
    });
    req.end();
  });
}

function decodeMintEscapes(raw) {
  return raw
    .replace(/\\"/g, "\"")
    .replace(/\\\//g, "/")
    .replace(/\\u0026/g, "&");
}

function parseSitemap(xml) {
  const entries = [];
  const regex = /<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>\s*<\/url>/g;
  for (const match of xml.matchAll(regex)) {
    const loc = match[1];
    const lastmod = match[2];
    if (!loc.includes("/api-reference/")) continue;
    const slug = loc.replace(`${DOCS_HOST}/`, "");
    entries.push({ slug, loc, lastmod });
  }
  return entries;
}

function parseApiReferenceGroups(introHtmlDecoded, sitemapEntries) {
  const groups = [];
  const groupRegex = /{"group":"([^"]+)"(?:,"openapi":"([^"]+)")?,"pages":\[(.*?)\]/gs;

  for (const match of introHtmlDecoded.matchAll(groupRegex)) {
    const name = match[1];
    const openapi = match[2] ?? null;
    const pagesRaw = match[3];
    const pages = [...pagesRaw.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    groups.push({ name, openapi, pages });
  }

  const result = new Map();
  for (const category of TARGET_CATEGORIES) {
    const candidates = groups
      .filter((g) => g.name === category)
      .map((g) => {
        const apiPages = g.pages.filter((p) => p.startsWith("api-reference/"));
        return {
          category,
          openapi: g.openapi,
          pages: apiPages,
          apiPageCount: apiPages.length,
        };
      })
      .filter((g) => g.apiPageCount > 0);

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.apiPageCount - a.apiPageCount);
      result.set(category, candidates[0]);
      continue;
    }

    if (category === "WebSocket") {
      const pages = sitemapEntries
        .map((x) => x.slug)
        .filter((slug) => slug.startsWith("api-reference/wss/"))
        .sort();
      result.set(category, {
        category,
        openapi: null,
        pages,
        apiPageCount: pages.length,
      });
      continue;
    }

    throw new Error(`Unable to resolve API reference group for category: ${category}`);
  }

  return result;
}

function parseOpenApiDescriptor(descriptor) {
  if (!descriptor) {
    return { spec: null, method: null, path: null };
  }
  const parts = descriptor.trim().split(/\s+/);
  if (parts.length < 3) {
    return { spec: descriptor, method: null, path: null };
  }
  const [spec, method, ...rest] = parts;
  return {
    spec,
    method: method.toUpperCase(),
    path: rest.join(" "),
  };
}

function parseEndpointMetadata(decodedHtml, slug) {
  const titleMatch = decodedHtml.match(/<title>([^<]+?) - Polymarket Documentation<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : slug.split("/").pop();

  const hrefPattern = escapeRegExp(`/${slug}`);
  const openapiRegex = new RegExp(`"openapi":"([^"]+?)"[^}]*?"href":"${hrefPattern}"`, "s");
  const openapiMatch = decodedHtml.match(openapiRegex);
  const descriptor = openapiMatch ? openapiMatch[1] : null;
  const parsed = parseOpenApiDescriptor(descriptor);

  return {
    endpointName: title,
    openapiDescriptor: descriptor,
    spec: parsed.spec,
    method: parsed.method,
    path: parsed.path,
  };
}

function readLocalState(rootDir) {
  const files = {
    mcpTools: path.join(rootDir, "src/openclaw/polymarket/mcp/tools.mjs"),
    gateway: path.join(rootDir, "src/openclaw/polymarket/polymarketGateway.mjs"),
    clob: path.join(rootDir, "src/openclaw/polymarket/clients/clobService.mjs"),
    gamma: path.join(rootDir, "src/openclaw/polymarket/clients/gammaClient.mjs"),
    data: path.join(rootDir, "src/openclaw/polymarket/clients/dataApiClient.mjs"),
    bridge: path.join(rootDir, "src/openclaw/polymarket/clients/bridgeClient.mjs"),
    ws: path.join(rootDir, "src/openclaw/polymarket/ws/channelClient.mjs"),
  };

  function read(filePath) {
    return fs.readFileSync(filePath, "utf8");
  }

  function extractAsyncMethods(source) {
    return new Set([...source.matchAll(/async\s+([A-Za-z0-9_]+)\s*\(/g)].map((m) => m[1]));
  }

  const toolsSource = read(files.mcpTools);
  const mcpTools = new Set([...toolsSource.matchAll(/name:\s*"((?:pm_[a-z0-9_]+))"/g)].map((m) => m[1]));

  return {
    files,
    mcpTools,
    gatewayMethods: extractAsyncMethods(read(files.gateway)),
    clobMethods: extractAsyncMethods(read(files.clob)),
    gammaMethods: extractAsyncMethods(read(files.gamma)),
    dataMethods: extractAsyncMethods(read(files.data)),
    bridgeMethods: extractAsyncMethods(read(files.bridge)),
    wsMethods: extractAsyncMethods(read(files.ws)),
  };
}

function callableEvidenceBySlug(slug) {
  const map = new Map([
    ["api-reference/markets/list-markets", [EVIDENCE.mcpMarketDiscover]],
    [
      "api-reference/search/search-markets-events-and-profiles",
      [EVIDENCE.mcpMarketDiscover],
    ],
    [
      "api-reference/market-data/get-order-book",
      [EVIDENCE.mcpQuoteGet],
    ],
    ["api-reference/market-data/get-market-price", [EVIDENCE.mcpQuoteGet]],
    ["api-reference/data/get-midpoint-price", [EVIDENCE.mcpQuoteGet]],
    ["api-reference/market-data/get-spread", [EVIDENCE.mcpQuoteGet]],
    ["api-reference/market-data/get-fee-rate", [EVIDENCE.mcpQuoteGet]],
    ["api-reference/market-data/get-fee-rate-by-path-parameter", [EVIDENCE.mcpQuoteGet]],
    ["api-reference/market-data/get-tick-size", [EVIDENCE.mcpQuoteGet]],
    ["api-reference/market-data/get-tick-size-by-path-parameter", [EVIDENCE.mcpQuoteGet]],
    ["api-reference/trade/post-a-new-order", [EVIDENCE.mcpOrderPlace]],
    ["api-reference/trade/post-multiple-orders", [EVIDENCE.mcpOrderBatchPlace]],
    ["api-reference/trade/get-user-orders", [EVIDENCE.mcpSyncOrders]],
    ["api-reference/trade/cancel-single-order", [EVIDENCE.mcpOrderCancel]],
    ["api-reference/trade/cancel-multiple-orders", [EVIDENCE.mcpOrderCancel]],
    ["api-reference/trade/cancel-all-orders", [EVIDENCE.mcpOrderCancelAll]],
    ["api-reference/trade/cancel-orders-for-a-market", [EVIDENCE.mcpOrderCancel]],
    ["api-reference/trade/get-trades", [EVIDENCE.mcpSyncTrades]],
    ["api-reference/core/get-current-positions-for-a-user", [EVIDENCE.mcpSyncPositions]],
    ["api-reference/core/get-user-activity", [EVIDENCE.mcpSyncPositions]],
    ["api-reference/core/get-total-value-of-a-users-positions", [EVIDENCE.mcpSyncPositions]],
    ["api-reference/core/get-trades-for-a-user-or-markets", [EVIDENCE.mcpSyncTrades, EVIDENCE.mcpSyncPositions]],
    ["api-reference/core/get-positions-for-a-market", [EVIDENCE.mcpSyncPositions]],
  ]);
  const direct = map.get(slug);
  if (direct) return direct;

  if (slug.startsWith("api-reference/events/")) return [EVIDENCE.mcpEventsGet];
  if (slug.startsWith("api-reference/tags/")) return [EVIDENCE.mcpTagsGet];
  if (slug.startsWith("api-reference/series/")) return [EVIDENCE.mcpSeriesGet];
  if (slug.startsWith("api-reference/comments/")) return [EVIDENCE.mcpCommentsGet];
  if (slug.startsWith("api-reference/sports/")) return [EVIDENCE.mcpSportsMetaGet];
  if (slug.startsWith("api-reference/wss/")) {
    return [EVIDENCE.mcpWsSubscribe, EVIDENCE.mcpWsPoll, EVIDENCE.mcpWsUnsubscribe];
  }
  if (slug.startsWith("api-reference/bridge/")) {
    if (slug.endsWith("get-supported-assets")) return [EVIDENCE.mcpBridgeSupportedAssets];
    if (slug.endsWith("get-a-quote")) return [EVIDENCE.mcpBridgeQuote];
    if (slug.endsWith("get-transaction-status")) return [EVIDENCE.mcpBridgeStatus];
    if (slug.endsWith("create-deposit-addresses")) return [EVIDENCE.mcpBridgeDeposit];
    if (slug.endsWith("create-withdrawal-addresses")) return [EVIDENCE.mcpBridgeWithdraw];
  }
  if (
    slug === "api-reference/market-data/get-order-books-request-body" ||
    slug === "api-reference/market-data/get-market-prices-query-parameters" ||
    slug === "api-reference/market-data/get-market-prices-request-body" ||
    slug === "api-reference/market-data/get-midpoint-prices-query-parameters" ||
    slug === "api-reference/market-data/get-midpoint-prices-request-body" ||
    slug === "api-reference/market-data/get-spreads"
  ) {
    return [EVIDENCE.mcpMarketDataBatchGet];
  }
  if (
    slug === "api-reference/data/get-server-time" ||
    slug === "api-reference/market-data/get-last-trade-price" ||
    slug === "api-reference/market-data/get-last-trade-prices-query-parameters" ||
    slug === "api-reference/market-data/get-last-trade-prices-request-body" ||
    slug === "api-reference/markets/get-prices-history" ||
    slug === "api-reference/trade/get-order-scoring-status" ||
    slug === "api-reference/trade/send-heartbeat"
  ) {
    return [EVIDENCE.mcpTradeMetaGet];
  }
  if (
    slug === "api-reference/core/get-closed-positions-for-a-user" ||
    slug === "api-reference/misc/get-total-markets-a-user-has-traded" ||
    slug === "api-reference/profiles/get-public-profile-by-wallet-address"
  ) {
    return [EVIDENCE.mcpProfileGet];
  }
  if (slug === "api-reference/core/get-trader-leaderboard-rankings") return [EVIDENCE.mcpLeaderboardGet];
  if (slug.startsWith("api-reference/builders/")) return [EVIDENCE.mcpBuilderAnalyticsGet];

  return [];
}

function internalEvidenceBySlug(slug) {
  if (slug.startsWith("api-reference/events/")) return [EVIDENCE.gammaClient];
  if (slug.startsWith("api-reference/markets/")) return [EVIDENCE.gammaClient, EVIDENCE.clobService];
  if (slug.startsWith("api-reference/market-data/")) return [EVIDENCE.clobService];
  if (slug.startsWith("api-reference/trade/")) return [EVIDENCE.clobService];
  if (slug.startsWith("api-reference/core/")) return [EVIDENCE.dataApiClient, EVIDENCE.clobService];
  if (slug.startsWith("api-reference/profiles/")) return [EVIDENCE.gammaClient, EVIDENCE.dataApiClient];
  if (slug.startsWith("api-reference/misc/")) return [EVIDENCE.dataApiClient];
  if (slug.startsWith("api-reference/builders/")) return [EVIDENCE.dataApiClient];
  if (slug.startsWith("api-reference/data/")) return [EVIDENCE.clobService];
  if (slug.startsWith("api-reference/tags/")) return [EVIDENCE.gammaClient];
  if (slug.startsWith("api-reference/series/")) return [EVIDENCE.gammaClient];
  if (slug.startsWith("api-reference/comments/")) return [EVIDENCE.gammaClient];
  if (slug.startsWith("api-reference/sports/")) return [EVIDENCE.gammaClient];
  if (slug.startsWith("api-reference/search/")) return [EVIDENCE.gammaClient];
  if (slug.startsWith("api-reference/bridge/")) return [EVIDENCE.bridgeClient, EVIDENCE.gateway];
  if (slug.startsWith("api-reference/wss/")) return [EVIDENCE.wsClient, EVIDENCE.gateway];
  return [];
}

function resolveStatus(slug, local) {
  let callableStatus = "MISSING";
  let internalStatus = "MISSING";

  if (CALLABLE_FULL.has(slug)) callableStatus = "FULL";
  if (CALLABLE_COMPOSITE.has(slug)) callableStatus = "COMPOSITE";

  if (INTERNAL_FULL.has(slug)) internalStatus = "FULL";
  if (INTERNAL_COMPOSITE.has(slug)) internalStatus = "COMPOSITE";

  if (slug.startsWith("api-reference/bridge/") && internalStatus === "FULL" && callableStatus === "MISSING") {
    callableStatus = "INTERNAL_ONLY";
  }
  if (slug.startsWith("api-reference/wss/") && internalStatus !== "MISSING" && callableStatus === "MISSING") {
    callableStatus = "INTERNAL_ONLY";
  }
  if (slug.startsWith("api-reference/events/") && internalStatus !== "MISSING" && callableStatus === "MISSING") {
    callableStatus = "INTERNAL_ONLY";
  }
  if (
    (slug.startsWith("api-reference/market-data/") ||
      slug.startsWith("api-reference/trade/") ||
      slug.startsWith("api-reference/markets/get-simplified-markets") ||
      slug.startsWith("api-reference/markets/get-sampling-markets") ||
      slug.startsWith("api-reference/markets/get-sampling-simplified-markets") ||
      slug.startsWith("api-reference/core/get-closed-positions-for-a-user")) &&
    internalStatus !== "MISSING" &&
    callableStatus === "MISSING"
  ) {
    callableStatus = "INTERNAL_ONLY";
  }

  if (slug === "api-reference/core/get-top-holders-for-markets" && callableStatus === "MISSING") {
    callableStatus = "INTERNAL_ONLY";
  }

  if (slug === "api-reference/trade/get-builder-trades" && callableStatus === "MISSING") {
    callableStatus = "INTERNAL_ONLY";
  }

  const toolRequirements = {
    "api-reference/markets/list-markets": "pm_market_discover",
    "api-reference/market-data/get-order-book": "pm_quote_get",
    "api-reference/trade/post-a-new-order": "pm_order_place",
    "api-reference/trade/post-multiple-orders": "pm_order_batch_place",
    "api-reference/trade/get-user-orders": "pm_sync_orders",
    "api-reference/trade/cancel-all-orders": "pm_order_cancel_all",
    "api-reference/trade/get-trades": "pm_sync_trades",
    "api-reference/core/get-current-positions-for-a-user": "pm_sync_positions",
  };
  const requiredTool = toolRequirements[slug];
  if (requiredTool && !local.mcpTools.has(requiredTool) && callableStatus !== "MISSING") {
    callableStatus = "MISSING";
  }

  const internalChecks = [
    { slug: "api-reference/events/list-events", ok: local.gammaMethods.has("getEvents") },
    { slug: "api-reference/markets/list-markets", ok: local.gammaMethods.has("getMarkets") },
    { slug: "api-reference/core/get-top-holders-for-markets", ok: local.dataMethods.has("getHolders") },
    { slug: "api-reference/trade/get-builder-trades", ok: local.clobMethods.has("getBuilderTrades") },
    { slug: "api-reference/bridge/get-supported-assets", ok: local.bridgeMethods.has("getSupportedAssets") },
    { slug: "api-reference/wss/market", ok: local.gatewayMethods.has("connectMarketStream") && local.wsMethods.has("connect") },
    { slug: "api-reference/wss/user", ok: local.gatewayMethods.has("connectUserStream") && local.wsMethods.has("connect") },
    { slug: "api-reference/market-data/get-order-book", ok: local.clobMethods.has("getOrderBook") },
    { slug: "api-reference/market-data/get-market-price", ok: local.clobMethods.has("getPrice") },
    { slug: "api-reference/data/get-server-time", ok: local.clobMethods.has("getServerTime") },
  ];
  for (const check of internalChecks) {
    if (check.slug === slug && !check.ok) {
      internalStatus = "MISSING";
      if (callableStatus === "INTERNAL_ONLY") callableStatus = "MISSING";
    }
  }

  const callableEvidence = callableEvidenceBySlug(slug);
  if (callableStatus === "INTERNAL_ONLY") {
    callableEvidence.push("No direct MCP tool exposure in src/openclaw/polymarket/mcp/tools.mjs");
  }

  const internalEvidence = internalEvidenceBySlug(slug);

  let gapNote = "";
  if (callableStatus === "FULL") {
    gapNote = "Directly callable via MCP tool.";
  } else if (callableStatus === "COMPOSITE") {
    gapNote = "Callable via composed MCP workflow (no dedicated 1:1 tool).";
  } else if (callableStatus === "INTERNAL_ONLY") {
    gapNote = "Implemented internally but not exposed as MCP tool.";
  } else if (internalStatus === "MISSING") {
    gapNote = "No implementation found in current gateway/clients.";
  } else {
    gapNote = "Not callable via current MCP tool surface.";
  }

  return {
    callableStatus,
    internalStatus,
    callableEvidence: [...new Set(callableEvidence)],
    internalEvidence: [...new Set(internalEvidence)],
    gapNote,
  };
}

async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) break;
      out[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.max(1, limit) }, () => worker());
  await Promise.all(workers);
  return out;
}

function buildMarkdownReport({ generatedAt, latestDocDate, matrix }) {
  const lines = [];
  lines.push("# Polymarket API × 当前 MCP 服务能力覆盖分析报告");
  lines.push("");
  lines.push(`- 生成时间: ${generatedAt}`);
  lines.push(`- 官方文档来源: ${INTRO_URL}`);
  lines.push(`- Sitemap: ${SITEMAP_URL}`);
  lines.push(`- 官方 API 参考最近更新时间: ${latestDocDate}`);
  lines.push(`- 评估口径: 能力级为主 + 双口径并行（MCP 可调用 / 内部实现）`);
  lines.push("");
  lines.push("## 背景与方法");
  lines.push("");
  lines.push("1. 从 `sitemap.xml` 抽取全部 `api-reference/*` 页面。");
  lines.push("2. 从 API Reference 导航抽取 17 个分类作为官方分类真值。");
  lines.push("3. 对每个 endpoint 页面解析标题、文档链接、`spec + method + path`（若有）。");
  lines.push("4. 扫描本地 `mcp/tools + gateway + clients + ws` 生成双口径状态。");
  lines.push("5. 输出覆盖矩阵与分级路线图。");
  lines.push("");
  lines.push("### 状态枚举");
  lines.push("");
  lines.push("- `FULL`: 1:1 直接支持。");
  lines.push("- `COMPOSITE`: 需组合调用实现。");
  lines.push("- `INTERNAL_ONLY`: 仅内部实现，未暴露 MCP tool。");
  lines.push("- `MISSING`: 未实现。");
  lines.push("");
  lines.push("## 总览（17 分类）");
  lines.push("");
  lines.push("| Category | Endpoints | MCP Callable (FULL+COMPOSITE) | Internal (FULL+COMPOSITE+INTERNAL_ONLY) |");
  lines.push("|---|---:|---:|---:|");
  for (const category of matrix.categories) {
    const callable = `${category.callableCovered}/${category.total} (${pct(category.callableCovered, category.total)})`;
    const internal = `${category.internalCovered}/${category.total} (${pct(category.internalCovered, category.total)})`;
    lines.push(`| ${category.name} | ${category.total} | ${callable} | ${internal} |`);
  }
  lines.push("");
  lines.push(`- Overall MCP callable coverage: ${matrix.summary.callableCovered}/${matrix.summary.total} (${pct(matrix.summary.callableCovered, matrix.summary.total)})`);
  lines.push(`- Overall internal coverage: ${matrix.summary.internalCovered}/${matrix.summary.total} (${pct(matrix.summary.internalCovered, matrix.summary.total)})`);
  lines.push("");
  lines.push("## 分类逐项明细");
  lines.push("");

  for (const category of matrix.categories) {
    lines.push(`### ${category.name}`);
    lines.push("");
    lines.push("| Endpoint Name | Method/Path | MCP Callable Status | Internal Status | Evidence | Gap Note | Doc URL |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const endpoint of category.endpoints) {
      const methodPath = endpoint.method && endpoint.path ? `${endpoint.method} ${endpoint.path}` : "-";
      const evidence = [
        endpoint.callableEvidence.length > 0 ? `callable: ${endpoint.callableEvidence.join("; ")}` : "",
        endpoint.internalEvidence.length > 0 ? `internal: ${endpoint.internalEvidence.join("; ")}` : "",
      ]
        .filter(Boolean)
        .join(" | ")
        .replace(/\|/g, "\\|");
      lines.push(
        `| ${endpoint.endpointName} | ${methodPath} | ${endpoint.callableStatus} | ${endpoint.internalStatus} | ${evidence || "-"} | ${endpoint.gapNote} | ${endpoint.docUrl} |`,
      );
    }
    lines.push("");
  }

  lines.push("## 关键缺口分析");
  lines.push("");
  lines.push("- 当前 MCP 工具面向交易主链路（下单/撤单/同步）较完整，但 **Events / Tags / Series / Comments / Sports / Bridge / WebSocket** 大量能力仍未可调用。");
  lines.push("- `Orderbook & Pricing` 内部覆盖较高，但 `last trade price / prices history / server time` 等仍未暴露 MCP。");
  lines.push("- `Profile` 仅覆盖当前仓位同步核心能力，`public profile / accounting snapshot / total markets traded` 仍缺失。");
  lines.push("- `Leaderboard`、`Builders`（Data API 维度）当前未实现。");
  lines.push("");
  lines.push("## 优先级路线图");
  lines.push("");
  lines.push("### P0（交易闭环与实时消费）");
  lines.push("");
  lines.push("- 新增 MCP: `pm_market_data_batch_get`（批量 prices/midpoints/spreads/orderbooks）。");
  lines.push("- 新增 MCP: `pm_trade_meta_get`（order scoring / heartbeat / last trade / prices history / server time）。");
  lines.push("- 新增 MCP: `pm_bridge_*`（supported-assets/quote/deposit/withdraw/status）。");
  lines.push("- 新增 MCP: `pm_ws_subscribe`（market/user/sports 统一订阅入口）。");
  lines.push("");
  lines.push("### P1（数据侧能力）");
  lines.push("");
  lines.push("- 新增 MCP: `pm_profile_get`（public profile + positions/activity/value + closed positions 聚合）。");
  lines.push("- 新增 MCP: `pm_leaderboard_get`（trader leaderboard）。");
  lines.push("- 新增 MCP: `pm_builder_analytics_get`（aggregated leaderboard + daily volume）。");
  lines.push("");
  lines.push("### P2（长尾与一致性）");
  lines.push("");
  lines.push("- 新增 MCP: `pm_events_get`、`pm_tags_get`、`pm_series_get`、`pm_comments_get`、`pm_sports_meta_get`。");
  lines.push("- 统一参数规范（`id/slug/address`）与分页结构（cursor/offset）。");
  lines.push("- 增加“接口覆盖回归脚本”并接入 CI，自动对比 docs 变更。");
  lines.push("");
  lines.push("## 验收检查");
  lines.push("");
  lines.push("- 17 个分类全部存在。");
  lines.push("- 每个分类 endpoint 数 > 0（WebSocket 为 3）。");
  lines.push("- MCP 工具扫描计数与 `tools.mjs` 一致。");
  lines.push("- Markdown 总览统计与 JSON 明细统计一致。");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const rootDir = path.resolve(__dirname, "..");
  const docsDir = path.join(rootDir, "docs");
  const reportPath = path.join(docsDir, "POLYMARKET_API_COVERAGE_ANALYSIS.md");
  const matrixPath = path.join(docsDir, "polymarket_api_coverage_matrix.json");

  const sitemapXml = await fetchText(SITEMAP_URL);
  const sitemapEntries = parseSitemap(sitemapXml);
  const sitemapMap = new Map(sitemapEntries.map((entry) => [entry.slug, entry]));

  const introHtmlRaw = await fetchText(INTRO_URL);
  const introHtmlDecoded = decodeMintEscapes(introHtmlRaw);

  const categoryMap = parseApiReferenceGroups(introHtmlDecoded, sitemapEntries);
  assertOk(categoryMap.size === TARGET_CATEGORIES.length, "Category count mismatch for API reference groups");

  const endpointRecords = [];
  for (const category of TARGET_CATEGORIES) {
    const entry = categoryMap.get(category);
    assertOk(entry.pages.length > 0, `Category ${category} has no endpoints`);
    for (const slug of entry.pages) {
      endpointRecords.push({
        category,
        slug,
        docUrl: `${DOCS_HOST}/${slug}`,
        groupOpenapi: entry.openapi,
        lastmod: sitemapMap.get(slug)?.lastmod ?? null,
      });
    }
  }

  const withMetadata = await mapWithConcurrency(endpointRecords, 8, async (record) => {
    const raw = await fetchText(record.docUrl);
    const decoded = decodeMintEscapes(raw);
    const meta = parseEndpointMetadata(decoded, record.slug);
    return {
      ...record,
      ...meta,
    };
  });

  const local = readLocalState(rootDir);
  assertOk(local.mcpTools.size >= 14, "MCP tool count unexpectedly low");

  const enriched = withMetadata.map((endpoint) => {
    const status = resolveStatus(endpoint.slug, local);
    return {
      ...endpoint,
      ...status,
    };
  });

  const categories = TARGET_CATEGORIES.map((name) => {
    const endpoints = enriched
      .filter((endpoint) => endpoint.category === name)
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .map((endpoint) => ({
        category: endpoint.category,
        slug: endpoint.slug,
        endpointName: endpoint.endpointName,
        docUrl: endpoint.docUrl,
        method: endpoint.method,
        path: endpoint.path,
        spec: endpoint.spec,
        openapiDescriptor: endpoint.openapiDescriptor,
        lastmod: endpoint.lastmod,
        callableStatus: endpoint.callableStatus,
        internalStatus: endpoint.internalStatus,
        callableEvidence: endpoint.callableEvidence,
        internalEvidence: endpoint.internalEvidence,
        gapNote: endpoint.gapNote,
      }));

    const total = endpoints.length;
    const callableCovered = endpoints.filter((e) => e.callableStatus === "FULL" || e.callableStatus === "COMPOSITE").length;
    const internalCovered = endpoints.filter(
      (e) => e.internalStatus === "FULL" || e.internalStatus === "COMPOSITE" || e.internalStatus === "INTERNAL_ONLY",
    ).length;

    return {
      name,
      total,
      callableCovered,
      internalCovered,
      callableCoverage: Number((callableCovered / total).toFixed(6)),
      internalCoverage: Number((internalCovered / total).toFixed(6)),
      endpoints,
    };
  });

  assertOk(categories.length === 17, "Expected 17 categories");
  assertOk(categories.every((category) => category.total > 0), "At least one category has no endpoints");

  const summary = categories.reduce(
    (acc, category) => {
      acc.total += category.total;
      acc.callableCovered += category.callableCovered;
      acc.internalCovered += category.internalCovered;
      return acc;
    },
    { total: 0, callableCovered: 0, internalCovered: 0 },
  );

  const latestDocDate = sitemapEntries
    .map((entry) => entry.lastmod)
    .sort()
    .slice(-1)[0];

  const generatedAt = new Date().toISOString();

  const matrix = {
    metadata: {
      generatedAt,
      docsHost: DOCS_HOST,
      introUrl: INTRO_URL,
      sitemapUrl: SITEMAP_URL,
      latestDocDate,
      baselineDate: "2026-02-28",
      categoryCount: categories.length,
      endpointCount: summary.total,
      mcpToolCount: local.mcpTools.size,
      mcpTools: [...local.mcpTools].sort(),
      statusEnum: ["FULL", "COMPOSITE", "INTERNAL_ONLY", "MISSING"],
      coverageFormula: {
        callable: "(FULL + COMPOSITE) / total",
        internal: "(FULL + COMPOSITE + INTERNAL_ONLY) / total",
      },
    },
    summary: {
      ...summary,
      callableCoverage: Number((summary.callableCovered / summary.total).toFixed(6)),
      internalCoverage: Number((summary.internalCovered / summary.total).toFixed(6)),
    },
    categories,
  };

  const markdown = buildMarkdownReport({
    generatedAt,
    latestDocDate,
    matrix,
  });

  fs.writeFileSync(reportPath, markdown, "utf8");
  fs.writeFileSync(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`, "utf8");

  console.log(`[coverage] report generated: ${reportPath}`);
  console.log(`[coverage] matrix generated: ${matrixPath}`);
  console.log(`[coverage] categories=${categories.length}, endpoints=${summary.total}, mcpTools=${local.mcpTools.size}`);
}

main().catch((error) => {
  console.error("[coverage] failed:", error?.stack ?? error?.message ?? String(error));
  process.exit(1);
});
