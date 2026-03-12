export const TOOL_ORDER = [
  "pm_auth_bootstrap",
  "pm_auth_validate",
  "pm_market_discover",
  "pm_quote_get",
  "pm_market_data_batch_get",
  "pm_trade_meta_get",
  "pm_balance_get",
  "pm_bridge_supported_assets_get",
  "pm_bridge_quote_get",
  "pm_bridge_status_get",
  "pm_bridge_deposit_create",
  "pm_bridge_withdraw_create",
  "pm_precheck_order",
  "pm_order_place",
  "pm_order_batch_place",
  "pm_order_cancel",
  "pm_order_cancel_all",
  "pm_sync_orders",
  "pm_sync_trades",
  "pm_sync_positions",
  "pm_profile_get",
  "pm_leaderboard_get",
  "pm_builder_analytics_get",
  "pm_events_get",
  "pm_tags_get",
  "pm_series_get",
  "pm_comments_get",
  "pm_sports_meta_get",
  "pm_ws_subscribe",
  "pm_ws_poll",
  "pm_ws_unsubscribe",
  "pm_metrics_snapshot",
];

export const TRADE_TOOL_SET = new Set([
  "pm_order_place",
  "pm_order_batch_place",
  "pm_order_cancel",
  "pm_order_cancel_all",
  "pm_bridge_deposit_create",
  "pm_bridge_withdraw_create",
]);

const DEFAULT_TOKEN_ID = "0";
const DEFAULT_CONDITION_ID = "0x0";
const DEFAULT_ADDRESS = "0x0000000000000000000000000000000000000000";

function normalizeTokenIds(market) {
  const direct = market?.clobTokenIds ?? market?.clob_token_ids ?? market?.outcomeTokenIds ?? [];
  if (Array.isArray(direct) && direct.length > 0) return direct.map((x) => String(x));
  if (typeof direct === "string" && direct.trim()) {
    try {
      const parsed = JSON.parse(direct);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x));
    } catch {
      // ignore invalid json
    }
  }

  if (Array.isArray(market?.tokens)) {
    return market.tokens
      .map((x) => x?.id ?? x?.tokenId ?? x?.token_id ?? x?.asset ?? x?.asset_id)
      .filter(Boolean)
      .map((x) => String(x));
  }

  return [];
}

export function resolveTokenFromPositions(positions = []) {
  if (!Array.isArray(positions)) return null;
  for (const item of positions) {
    const token = item?.asset ?? item?.asset_id ?? item?.tokenId ?? item?.token_id;
    if (token) {
      return {
        tokenId: String(token),
        conditionId: String(item?.conditionId ?? item?.condition_id ?? ""),
      };
    }
  }
  return null;
}

export function resolveTokenFromMarkets(markets = []) {
  if (!Array.isArray(markets)) return null;
  for (const market of markets) {
    const tokenIds = normalizeTokenIds(market);
    if (tokenIds.length > 0) {
      return {
        tokenId: tokenIds[0],
        conditionId: String(market?.conditionId ?? market?.condition_id ?? ""),
      };
    }
  }
  return null;
}

function baseIntent(tokenId, conditionId) {
  return {
    tokenId,
    conditionId,
    side: "BUY",
    orderType: "LIMIT",
    size: 1,
    limitPrice: 0.5,
    timeInForce: "GTC",
    postOnly: true,
  };
}

export function buildDefaultArgsByTool({
  tokenId = DEFAULT_TOKEN_ID,
  conditionId = DEFAULT_CONDITION_ID,
  address = DEFAULT_ADDRESS,
} = {}) {
  const intent = baseIntent(tokenId, conditionId);
  const context = {
    skillId: "ui-manual-debug",
    countryCode: "SG",
    idempotencyKey: `ui-manual-debug:${tokenId}`,
  };

  return {
    pm_auth_bootstrap: { autoAuth: true },
    pm_auth_validate: { recover: true },
    pm_market_discover: { limit: 10, active: true, tradableOnly: true },
    pm_quote_get: { tokenId, side: "BUY" },
    pm_market_data_batch_get: {
      tokenIds: [tokenId],
      side: "BUY",
      include: {
        prices: true,
        midpoints: true,
        spreads: true,
        orderBooks: true,
      },
    },
    pm_trade_meta_get: { action: "server_time" },
    pm_balance_get: { assetType: "COLLATERAL", updateFirst: false },
    pm_bridge_supported_assets_get: {},
    pm_bridge_quote_get: {
      payload: {
        amount: "1",
        fromAsset: "USDC",
        toAsset: "USDC",
      },
    },
    pm_bridge_status_get: {
      address,
      params: {},
    },
    pm_bridge_deposit_create: {
      payload: {
        user: address,
        asset: "USDC",
      },
      dryRun: true,
    },
    pm_bridge_withdraw_create: {
      payload: {
        user: address,
        asset: "USDC",
        amount: "1",
      },
      dryRun: true,
    },
    pm_precheck_order: { intent, context },
    pm_order_place: { intent, context, dryRun: true },
    pm_order_batch_place: { intents: [intent], dryRun: true },
    pm_order_cancel: { payload: { all: true }, dryRun: true },
    pm_order_cancel_all: { dryRun: true },
    pm_sync_orders: { params: {} },
    pm_sync_trades: { params: {} },
    pm_sync_positions: {
      params: {
        address,
        includeOpenOrders: false,
        includeClobTrades: false,
        includeNotifications: false,
      },
    },
    pm_profile_get: {
      address,
      include: {
        publicProfile: true,
        positions: true,
        activity: true,
        value: true,
        closedPositions: true,
        traded: true,
      },
    },
    pm_leaderboard_get: {
      category: "OVERALL",
      timePeriod: "DAY",
      limit: 10,
      offset: 0,
    },
    pm_builder_analytics_get: {
      timePeriod: "DAY",
      include: {
        leaderboard: true,
        volume: true,
      },
    },
    pm_events_get: {
      action: "list",
      query: { limit: 10 },
    },
    pm_tags_get: {
      action: "list",
      query: { limit: 10 },
    },
    pm_series_get: {
      action: "list",
      query: { limit: 10 },
    },
    pm_comments_get: {
      action: "list",
      query: { limit: 10 },
    },
    pm_sports_meta_get: {
      action: "sports",
    },
    pm_ws_subscribe: {
      channel: "market",
      subscription: {
        assets_ids: [tokenId],
      },
      ttlMs: 60000,
      maxQueue: 200,
    },
    pm_ws_poll: {
      sessionId: "auto",
      channel: "market",
      maxEvents: 20,
      waitMs: 2000,
    },
    pm_ws_unsubscribe: {
      sessionId: "auto",
      channel: "market",
    },
    pm_metrics_snapshot: {},
  };
}
