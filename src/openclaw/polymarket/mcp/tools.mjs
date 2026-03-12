import * as z from "zod/v4";
import { RiskBlockedError, ValidationError } from "../errors.mjs";
import { AssetType } from "../clients/clobService.mjs";
import { WsSessionManager } from "../ws/sessionManager.mjs";

function assertObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${name} must be an object`);
  }
}

function resolveSignalOrIntent(args) {
  const signal = args?.signal;
  const intent = args?.intent;

  if (signal) return signal;
  if (intent) return intent;

  throw new ValidationError("Either signal or intent is required");
}

function riskWarnings(result) {
  if (!result) return [];
  if (Array.isArray(result.warnings)) return result.warnings;

  const decision = result.rawExchangePayload?.riskDecision;
  if (Array.isArray(decision?.reasonCodes)) return decision.reasonCodes;

  return [];
}

function resolveAssetType(raw) {
  if (raw === "CONDITIONAL") return AssetType.CONDITIONAL;
  return AssetType.COLLATERAL;
}

function validateCancelPayload(payload) {
  if (payload?.orderID) return { mode: "orderID" };
  if (Array.isArray(payload?.orderIDs) && payload.orderIDs.length > 0)
    return { mode: "orderIDs" };
  if (payload?.market || payload?.asset_id) return { mode: "market" };
  if (payload?.all) return { mode: "all" };
  throw new ValidationError(
    "cancel payload must include orderID, orderIDs, market/asset_id, or all=true",
  );
}

function uniqueWarnings(items = []) {
  return Array.from(new Set(items.filter(Boolean).map((x) => String(x))));
}

function bridgeWriteEnabled() {
  return process.env.PM_MCP_ENABLE_BRIDGE_WRITES === "1";
}

function ensureBridgeWriteAllowed({ dryRun }) {
  if (dryRun) return;
  if (!bridgeWriteEnabled()) {
    throw new ValidationError(
      "Bridge write operations are disabled. Set PM_MCP_ENABLE_BRIDGE_WRITES=1 and pass dryRun=false to execute.",
    );
  }
}

function normalizeBridgePreview(action, payload) {
  return {
    dryRun: true,
    accepted: true,
    finalStatus: "DRY_RUN",
    preview: {
      action,
      payload,
    },
  };
}

export function buildPolymarketMcpTools({ gateway }) {
  let initialized = false;
  const wsSessions = new WsSessionManager({ gateway });

  async function ensureInitialized({ autoAuth = false } = {}) {
    if (initialized) return;
    await gateway.initialize({ autoAuth });
    initialized = true;
  }

  return [
    {
      name: "pm_auth_bootstrap",
      description:
        "Create or recover CLOB L2 API credentials and initialize gateway",
      inputSchema: {
        autoAuth: z.boolean().optional(),
      },
      async execute(args = {}) {
        const init = await gateway.initialize({
          autoAuth: args.autoAuth ?? true,
        });
        initialized = true;
        return { data: init };
      },
    },
    {
      name: "pm_auth_validate",
      description:
        "Validate current L2 credentials and optionally recover when invalid",
      inputSchema: {
        recover: z.boolean().optional(),
      },
      async execute(args = {}) {
        const recover = args.recover ?? true;
        const hasCreds = Boolean(gateway.clob.getApiCreds()?.key);
        const valid = hasCreds
          ? await gateway.credentials.validateCurrentCreds()
          : false;

        if (valid) {
          initialized = true;
          return { data: { valid: true, recovered: false, hasCreds: true } };
        }

        if (!recover) {
          return { data: { valid: false, recovered: false, hasCreds } };
        }

        await gateway.credentials.validateOrRecover();
        initialized = true;
        return { data: { valid: true, recovered: true, hasCreds: true } };
      },
    },
    {
      name: "pm_market_discover",
      description: "Discover tradable markets from Gamma",
      inputSchema: {
        query: z.string().optional(),
        tags: z.array(z.string()).optional(),
        eventSlug: z.string().optional(),
        limit: z.number().int().positive().optional(),
        active: z.boolean().optional(),
        closed: z.boolean().optional(),
        archived: z.boolean().optional(),
        tradableOnly: z.boolean().optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        const markets = await gateway.discoverMarkets(args);
        return { data: { count: markets.length, markets } };
      },
    },
    {
      name: "pm_quote_get",
      description: "Get quote and orderbook snapshot for a token",
      inputSchema: {
        tokenId: z.string(),
        side: z.enum(["BUY", "SELL"]).optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        if (!args.tokenId) throw new ValidationError("tokenId is required");
        const quote = await gateway.getQuote({
          tokenId: args.tokenId,
          side: args.side ?? "BUY",
        });
        return { data: quote };
      },
    },
    {
      name: "pm_market_data_batch_get",
      description:
        "Get batch market data (prices/midpoints/spreads/orderbooks/tickSize/feeRate) for token ids",
      inputSchema: {
        tokenIds: z.array(z.string()).min(1),
        side: z.enum(["BUY", "SELL"]).optional(),
        include: z
          .object({
            prices: z.boolean().optional(),
            midpoints: z.boolean().optional(),
            spreads: z.boolean().optional(),
            orderBooks: z.boolean().optional(),
            tickSize: z.boolean().optional(),
            feeRate: z.boolean().optional(),
          })
          .optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        const result = await gateway.getMarketDataBatch(args);
        return { data: result, warnings: result?.warnings ?? [] };
      },
    },
    {
      name: "pm_trade_meta_get",
      description:
        "Get trade metadata by action (server_time/order_scoring/heartbeat/last_trade/last_trades/prices_history)",
      inputSchema: {
        action: z.enum([
          "server_time",
          "order_scoring",
          "heartbeat",
          "last_trade",
          "last_trades",
          "prices_history",
        ]),
        tokenId: z.string().optional(),
        tokenIds: z.array(z.string()).optional(),
        orderId: z.string().optional(),
        orderIds: z.array(z.string()).optional(),
        heartbeatId: z.string().optional(),
        params: z.record(z.string(), z.any()).optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        const result = await gateway.getTradeMeta(args);
        return { data: { action: args.action, result } };
      },
    },
    {
      name: "pm_balance_get",
      description:
        "Get balance and allowance for collateral or conditional asset",
      inputSchema: {
        assetType: z.enum(["COLLATERAL", "CONDITIONAL"]).optional(),
        updateFirst: z.boolean().optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        const assetType = resolveAssetType(args.assetType);
        if (args.updateFirst ?? true) {
          await gateway.clob.updateBalanceAllowance({ asset_type: assetType });
        }

        const balance = await gateway.clob.getBalanceAllowance({
          asset_type: assetType,
        });
        return { data: balance };
      },
    },
    {
      name: "pm_bridge_supported_assets_get",
      description: "Get bridge supported assets",
      inputSchema: {
        params: z.record(z.string(), z.any()).optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        const result = await gateway.bridgeFunds(
          "supported-assets",
          args.params ?? {},
        );
        return { data: result };
      },
    },
    {
      name: "pm_bridge_quote_get",
      description: "Get bridge quote",
      inputSchema: {
        payload: z.record(z.string(), z.any()),
      },
      async execute(args = {}) {
        await ensureInitialized();
        assertObject(args.payload, "payload");
        const result = await gateway.bridgeFunds("quote", args.payload);
        return { data: result };
      },
    },
    {
      name: "pm_bridge_status_get",
      description: "Get bridge status by address",
      inputSchema: {
        address: z.string(),
        params: z.record(z.string(), z.any()).optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        if (!args.address) throw new ValidationError("address is required");
        const result = await gateway.bridgeFunds("status", {
          address: args.address,
          params: args.params ?? {},
        });
        return { data: result };
      },
    },
    {
      name: "pm_bridge_deposit_create",
      description:
        "Create bridge deposit address (dryRun by default; live requires PM_MCP_ENABLE_BRIDGE_WRITES=1)",
      inputSchema: {
        payload: z.record(z.string(), z.any()),
        dryRun: z.boolean().optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        assertObject(args.payload, "payload");
        const dryRun = args.dryRun ?? true;
        ensureBridgeWriteAllowed({ dryRun });
        if (dryRun) {
          return { data: normalizeBridgePreview("deposit", args.payload) };
        }
        const result = await gateway.bridgeFunds("deposit", args.payload);
        return { data: result };
      },
    },
    {
      name: "pm_bridge_withdraw_create",
      description:
        "Create bridge withdrawal address (dryRun by default; live requires PM_MCP_ENABLE_BRIDGE_WRITES=1)",
      inputSchema: {
        payload: z.record(z.string(), z.any()),
        dryRun: z.boolean().optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        assertObject(args.payload, "payload");
        const dryRun = args.dryRun ?? true;
        ensureBridgeWriteAllowed({ dryRun });
        if (dryRun) {
          return { data: normalizeBridgePreview("withdraw", args.payload) };
        }
        const result = await gateway.bridgeFunds("withdraw", args.payload);
        return { data: result };
      },
    },
    {
      name: "pm_precheck_order",
      description:
        "Run risk prechecks and return execution decision without placing order",
      inputSchema: {
        signal: z.record(z.string(), z.any()).optional(),
        intent: z.record(z.string(), z.any()).optional(),
        context: z.record(z.string(), z.any()).optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        const orderPayload = resolveSignalOrIntent(args);
        const context = args.context ?? {};
        assertObject(context, "context");

        const precheck = await gateway.precheckOrder(orderPayload, context);
        const warnings =
          precheck?.warnings ?? precheck.riskDecision?.reasonCodes ?? [];
        return { data: precheck, warnings };
      },
    },
    {
      name: "pm_order_place",
      description: "Place a single order from SkillSignal or TradeIntent",
      inputSchema: {
        signal: z.record(z.string(), z.any()).optional(),
        intent: z.record(z.string(), z.any()).optional(),
        context: z.record(z.string(), z.any()).optional(),
        dryRun: z.boolean().optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        const orderPayload = resolveSignalOrIntent(args);
        const context = args.context ?? {};
        assertObject(context, "context");
        const dryRun = Boolean(args.dryRun);

        if (dryRun) {
          const precheck = await gateway.precheckOrder(orderPayload, context);
          const blocked = precheck?.riskDecision?.effectiveAction === "BLOCK";
          return {
            data: {
              dryRun: true,
              accepted: !blocked,
              orderIds: [],
              tradeIds: [],
              finalStatus: "DRY_RUN",
              preview: precheck,
            },
            warnings:
              precheck?.warnings ?? precheck?.riskDecision?.reasonCodes ?? [],
          };
        }

        let result;
        try {
          result = await gateway.placeOrder(orderPayload, context);
        } catch (placementErr) {
          // ── Surface the upstream 400/4xx error body so the MCP client sees the real rejection reason ──
          const upstreamBody =
            placementErr?.details?.upstreamResponseBody ??
            placementErr?.details?.body ??
            null;
          const submissionAttempts =
            placementErr?.details?.submissionDiagnostics?.submissionAttempts ??
            null;
          const orderPayloadSent =
            placementErr?.details?.orderPayloadSent ?? null;
          const errorCode =
            placementErr?.details?.errorCode ??
            placementErr?.details?.code ??
            "ORDER_PLACEMENT_FAILED";
          throw new RiskBlockedError(
            placementErr?.message ?? "Order placement failed",
            {
              errorCode,
              upstreamResponseBody: upstreamBody,
              orderPayloadSent,
              submissionAttempts,
              result: placementErr?.details?.result ?? null,
              riskDecision: placementErr?.details?.riskDecision ?? null,
              stack: placementErr?.stack,
              recommendedActions: [
                "Check upstreamResponseBody for the exact Polymarket CLOB rejection reason",
                "Verify negRisk flag matches the market (neg-risk markets use a different exchange contract)",
                "Retry pm_order_place with a fresh idempotencyKey",
              ],
            },
          );
        }
        const warnings = riskWarnings(result);

        if (!result?.accepted) {
          const errorCode = result?.errorCode ?? "ORDER_REJECTED";
          // Extract upstream rejection details from submission diagnostics
          const submissionAttempts =
            result?.rawExchangePayload?.submissionDiagnostics
              ?.submissionAttempts ?? [];
          const upstreamBodies = submissionAttempts
            .filter((a) => a.responseBody)
            .map((a) => ({
              mode: a.mode,
              status: a.status,
              body: a.responseBody,
            }));
          throw new RiskBlockedError("Order blocked by risk engine", {
            errorCode,
            result,
            riskDecision: result?.rawExchangePayload?.riskDecision,
            submissionDiagnostics:
              result?.rawExchangePayload?.submissionDiagnostics,
            upstreamRejections:
              upstreamBodies.length > 0 ? upstreamBodies : undefined,
            recommendedActions:
              errorCode === "ORDER_SUBMISSION_UNCONFIRMED"
                ? [
                    "Run pm_sync_orders for signer/funder addresses to verify no orphan order was created",
                    "Retry pm_order_place with a fresh idempotencyKey",
                  ]
                : [
                    "Check upstreamRejections for the exact Polymarket CLOB rejection reason",
                    "Verify negRisk flag matches the market",
                    "Retry pm_order_place with a fresh idempotencyKey",
                  ],
          });
        }

        return { data: result, warnings };
      },
    },
    {
      name: "pm_order_batch_place",
      description: "Place a batch of limit orders",
      inputSchema: {
        intents: z.array(z.record(z.string(), z.any())),
        options: z
          .object({
            deferExec: z.boolean().optional(),
            defaultPostOnly: z.boolean().optional(),
          })
          .optional(),
        dryRun: z.boolean().optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        if (!Array.isArray(args.intents) || args.intents.length === 0) {
          throw new ValidationError("intents must be a non-empty array");
        }

        if (args.dryRun) {
          const prechecks = await Promise.all(
            args.intents.map(async (intent, index) => {
              const precheck = await gateway.precheckOrder(intent, {
                batchIndex: index,
                dryRun: true,
              });
              return {
                index,
                intent,
                precheck,
              };
            }),
          );

          const warnings = uniqueWarnings(
            prechecks.flatMap(
              (item) => item.precheck?.riskDecision?.reasonCodes ?? [],
            ),
          );

          const blockedCount = prechecks.filter(
            (item) => item.precheck?.riskDecision?.effectiveAction === "BLOCK",
          ).length;

          return {
            data: {
              dryRun: true,
              accepted: blockedCount === 0,
              orderIds: [],
              tradeIds: [],
              finalStatus: "DRY_RUN",
              preview: {
                intentsCount: args.intents.length,
                blockedCount,
                intents: prechecks,
                options: args.options ?? {},
              },
            },
            warnings,
          };
        }

        const result = await gateway.batchPlaceOrders(
          args.intents,
          args.options ?? {},
        );
        return { data: result };
      },
    },
    {
      name: "pm_order_cancel",
      description: "Cancel order by id(s) or by market payload",
      inputSchema: {
        payload: z.record(z.string(), z.any()),
        dryRun: z.boolean().optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        assertObject(args.payload, "payload");
        const mode = validateCancelPayload(args.payload);

        if (args.dryRun) {
          return {
            data: {
              dryRun: true,
              accepted: true,
              finalStatus: "DRY_RUN",
              preview: {
                mode: mode.mode,
                payload: args.payload,
              },
            },
          };
        }

        const result = await gateway.cancel(args.payload);
        return { data: result };
      },
    },
    {
      name: "pm_order_cancel_all",
      description: "Cancel all open orders",
      inputSchema: {
        dryRun: z.boolean().optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        if (args.dryRun) {
          return {
            data: {
              dryRun: true,
              accepted: true,
              finalStatus: "DRY_RUN",
              preview: { all: true },
            },
          };
        }
        const result = await gateway.cancel({ all: true });
        return { data: result };
      },
    },
    {
      name: "pm_sync_orders",
      description: "Sync open orders",
      inputSchema: {
        params: z.record(z.string(), z.any()).optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        const result = await gateway.syncOrders(args.params ?? {});
        return { data: result };
      },
    },
    {
      name: "pm_sync_trades",
      description: "Sync CLOB and Data API trades",
      inputSchema: {
        params: z.record(z.string(), z.any()).optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        const result = await gateway.syncTrades(args.params ?? {});
        return { data: result };
      },
    },
    {
      name: "pm_sync_positions",
      description: "Sync open orders, positions, activity and account value",
      inputSchema: {
        params: z.record(z.string(), z.any()).optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        const result = await gateway.syncPositions(args.params ?? {});
        const warnings = Array.isArray(result?.syncIssues)
          ? result.syncIssues.map((x) => `[${x.source}] ${x.message}`)
          : [];
        return { data: result, warnings };
      },
    },
    {
      name: "pm_profile_get",
      description:
        "Get aggregated profile data (public profile + positions + activity + value + closed positions + traded)",
      inputSchema: {
        address: z.string(),
        include: z
          .object({
            publicProfile: z.boolean().optional(),
            positions: z.boolean().optional(),
            activity: z.boolean().optional(),
            value: z.boolean().optional(),
            closedPositions: z.boolean().optional(),
            traded: z.boolean().optional(),
          })
          .optional(),
        publicProfileParams: z.record(z.string(), z.any()).optional(),
        positionsParams: z.record(z.string(), z.any()).optional(),
        activityParams: z.record(z.string(), z.any()).optional(),
        valueParams: z.record(z.string(), z.any()).optional(),
        closedPositionsParams: z.record(z.string(), z.any()).optional(),
        tradedParams: z.record(z.string(), z.any()).optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        if (!args.address) throw new ValidationError("address is required");
        const result = await gateway.getProfileAggregate(args);
        return { data: result, warnings: result?.warnings ?? [] };
      },
    },
    {
      name: "pm_leaderboard_get",
      description: "Get trader leaderboard rankings",
      inputSchema: {
        category: z.string().optional(),
        timePeriod: z.string().optional(),
        limit: z.number().int().nonnegative().optional(),
        offset: z.number().int().nonnegative().optional(),
        params: z.record(z.string(), z.any()).optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        const query = {
          ...(args.params ?? {}),
          ...(args.category ? { category: args.category } : {}),
          ...(args.timePeriod ? { timePeriod: args.timePeriod } : {}),
          ...(args.limit !== undefined ? { limit: args.limit } : {}),
          ...(args.offset !== undefined ? { offset: args.offset } : {}),
        };
        const result = await gateway.getLeaderboard(query);
        return { data: result };
      },
    },
    {
      name: "pm_builder_analytics_get",
      description:
        "Get aggregated builder leaderboard and daily volume time-series",
      inputSchema: {
        include: z
          .object({
            leaderboard: z.boolean().optional(),
            volume: z.boolean().optional(),
          })
          .optional(),
        timePeriod: z.string().optional(),
        leaderboardParams: z.record(z.string(), z.any()).optional(),
        volumeParams: z.record(z.string(), z.any()).optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        const timePeriod = args.timePeriod;
        const normalized = {
          ...args,
          leaderboardParams: {
            ...(args.leaderboardParams ?? {}),
            ...(timePeriod ? { timePeriod } : {}),
          },
          volumeParams: {
            ...(args.volumeParams ?? {}),
            ...(timePeriod ? { timePeriod } : {}),
          },
        };
        const result = await gateway.getBuilderAnalytics(normalized);
        return { data: result, warnings: result?.warnings ?? [] };
      },
    },
    {
      name: "pm_events_get",
      description: "Get events by action: list/by_id/by_slug/tags",
      inputSchema: {
        action: z.enum(["list", "by_id", "by_slug", "tags"]).optional(),
        id: z.union([z.number().int(), z.string()]).optional(),
        slug: z.string().optional(),
        query: z.record(z.string(), z.any()).optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        const result = await gateway.getEvents(args);
        return { data: result };
      },
    },
    {
      name: "pm_tags_get",
      description:
        "Get tags by action: list/by_id/by_slug/related_relations_by_id/related_relations_by_slug/related_tags_by_id/related_tags_by_slug",
      inputSchema: {
        action: z
          .enum([
            "list",
            "by_id",
            "by_slug",
            "related_relations_by_id",
            "related_relations_by_slug",
            "related_tags_by_id",
            "related_tags_by_slug",
          ])
          .optional(),
        id: z.union([z.number().int(), z.string()]).optional(),
        slug: z.string().optional(),
        query: z.record(z.string(), z.any()).optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        const result = await gateway.getTags(args);
        return { data: result };
      },
    },
    {
      name: "pm_series_get",
      description: "Get series by action: list/by_id",
      inputSchema: {
        action: z.enum(["list", "by_id"]).optional(),
        id: z.union([z.number().int(), z.string()]).optional(),
        query: z.record(z.string(), z.any()).optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        const result = await gateway.getSeries(args);
        return { data: result };
      },
    },
    {
      name: "pm_comments_get",
      description: "Get comments by action: list/by_id/by_user_address",
      inputSchema: {
        action: z.enum(["list", "by_id", "by_user_address"]).optional(),
        id: z.union([z.number().int(), z.string()]).optional(),
        userAddress: z.string().optional(),
        query: z.record(z.string(), z.any()).optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        const result = await gateway.getComments(args);
        return { data: result };
      },
    },
    {
      name: "pm_sports_meta_get",
      description: "Get sports metadata by action: sports/market_types/teams",
      inputSchema: {
        action: z.enum(["sports", "market_types", "teams"]).optional(),
        query: z.record(z.string(), z.any()).optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        const result = await gateway.getSportsMeta(args);
        return { data: result };
      },
    },
    {
      name: "pm_ws_subscribe",
      description: "Subscribe websocket session for market/user/sports channel",
      inputSchema: {
        channel: z.enum(["market", "user", "sports"]),
        subscription: z.record(z.string(), z.any()).optional(),
        ttlMs: z.number().int().positive().optional(),
        maxQueue: z.number().int().positive().optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        const result = await wsSessions.subscribe({
          channel: args.channel,
          subscription: args.subscription ?? {},
          ttlMs: args.ttlMs,
          maxQueue: args.maxQueue,
        });
        return { data: result };
      },
    },
    {
      name: "pm_ws_poll",
      description: "Poll websocket events from a ws session id",
      inputSchema: {
        sessionId: z.string().optional(),
        channel: z.enum(["market", "user", "sports"]).optional(),
        maxEvents: z.number().int().positive().optional(),
        waitMs: z.number().int().nonnegative().optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        const result = await wsSessions.poll({
          sessionId: args.sessionId,
          channel: args.channel,
          maxEvents: args.maxEvents,
          waitMs: args.waitMs,
        });
        return { data: result };
      },
    },
    {
      name: "pm_ws_unsubscribe",
      description: "Unsubscribe and close websocket session",
      inputSchema: {
        sessionId: z.string().optional(),
        channel: z.enum(["market", "user", "sports"]).optional(),
      },
      async execute(args = {}) {
        await ensureInitialized();
        const result = await wsSessions.unsubscribe({
          sessionId: args.sessionId,
          channel: args.channel,
        });
        return { data: result };
      },
    },
    {
      name: "pm_metrics_snapshot",
      description: "Read in-memory metrics snapshot",
      inputSchema: {},
      async execute() {
        const result = gateway.metricsSnapshot();
        return { data: result };
      },
    },
  ];
}
