import { createPolymarketConfig, mergeConfig } from "./config.mjs";
import { loadDotEnv } from "./env.mjs";
import { ClobService } from "./clients/clobService.mjs";
import { GammaClient } from "./clients/gammaClient.mjs";
import { DataApiClient } from "./clients/dataApiClient.mjs";
import { BridgeClient } from "./clients/bridgeClient.mjs";
import { RelayerClient } from "./clients/relayerClient.mjs";
import { BuilderClient } from "./clients/builderClient.mjs";
import { CredentialManager } from "./auth/credentialManager.mjs";
import { MarketDiscoveryService } from "./services/marketDiscoveryService.mjs";
import { QuoteService } from "./services/quoteService.mjs";
import { PositionService } from "./services/positionService.mjs";
import { InventoryService } from "./services/inventoryService.mjs";
import { RiskEngine } from "./risk/riskEngine.mjs";
import { IntentCompiler } from "./execution/intentCompiler.mjs";
import { ExecutionEngine } from "./execution/executionEngine.mjs";
import { MetricsCollector } from "./observability/metricsCollector.mjs";
import { AuditLogger } from "./observability/auditLogger.mjs";
import { WsChannelClient } from "./ws/channelClient.mjs";
import { ValidationError } from "./errors.mjs";
import { RiskDecisionKind, RiskEffectiveAction } from "./types.mjs";

function lower(value) {
  return String(value ?? "").toLowerCase();
}

function parseAccountValue(rawValue) {
  if (Array.isArray(rawValue) && rawValue.length > 0) {
    return Number(rawValue[0]?.value ?? 0);
  }
  if (rawValue && typeof rawValue === "object") {
    return Number(rawValue.value ?? 0);
  }
  return Number(rawValue ?? 0);
}

function looksEmptyPortfolio(result) {
  const positionsLen = Array.isArray(result?.positions)
    ? result.positions.length
    : 0;
  const activityLen = Array.isArray(result?.activity)
    ? result.activity.length
    : 0;
  const accountValue = parseAccountValue(result?.value);
  return (
    positionsLen === 0 &&
    activityLen === 0 &&
    (!Number.isFinite(accountValue) || accountValue <= 0)
  );
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function mergeIncludeFlags(defaults, include) {
  return { ...defaults, ...(include ?? {}) };
}

function uniqueWarnings(items = []) {
  return Array.from(
    new Set(
      (Array.isArray(items) ? items : []).filter(Boolean).map((x) => String(x)),
    ),
  );
}

function isConditionIdHash(value) {
  const text = String(value ?? "").trim();
  return /^0x[a-fA-F0-9]{64}$/.test(text);
}

function normalizeMarketTokenIds(market) {
  const direct =
    market?.clobTokenIds ??
    market?.clob_token_ids ??
    market?.outcomeTokenIds ??
    [];
  if (Array.isArray(direct)) {
    return direct.map((item) => String(item)).filter(Boolean);
  }
  if (typeof direct === "string" && direct.trim()) {
    try {
      const parsed = JSON.parse(direct);
      if (Array.isArray(parsed))
        return parsed.map((item) => String(item)).filter(Boolean);
    } catch {
      // ignore invalid json
    }
  }
  if (Array.isArray(market?.tokens)) {
    return market.tokens
      .map(
        (item) =>
          item?.id ??
          item?.tokenId ??
          item?.token_id ??
          item?.asset ??
          item?.asset_id,
      )
      .filter(Boolean)
      .map((item) => String(item));
  }
  return [];
}

export class PolymarketGateway {
  constructor(options = {}) {
    loadDotEnv(options.dotenvPath ?? ".env");

    const defaults = createPolymarketConfig();
    this.config = mergeConfig(defaults, options.config ?? {});

    if (!this.config.proxyUrl) {
      throw new ValidationError("POLYMARKET_PROXY_URL is required");
    }

    const privateKey = options.privateKey ?? process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new ValidationError(
        "privateKey is required (options.privateKey or PRIVATE_KEY env)",
      );
    }

    this.metrics = new MetricsCollector();
    this.audit = new AuditLogger({
      filePath: options.auditLogPath ?? "./audit/polymarket-audit.log",
    });

    this.clob = new ClobService({
      config: this.config,
      privateKey,
      signatureType: Number(
        options.signatureType ?? process.env.SIGNATURE_TYPE ?? 2,
      ),
      funderAddress: options.funderAddress ?? process.env.FUNDER_ADDRESS,
      geoBlockToken: options.geoBlockToken,
      useServerTime:
        options.useServerTime ?? process.env.USE_SERVER_TIME !== "false", // default true; set USE_SERVER_TIME=false to disable
      builderConfig: options.builderConfig,
      auditLogger: this.audit,
    });

    const envCreds = {
      key: options.apiKey ?? process.env.API_KEY,
      secret: options.secret ?? process.env.SECRET,
      passphrase: options.passphrase ?? process.env.PASSPHRASE,
    };

    if (envCreds.key && envCreds.secret && envCreds.passphrase) {
      this.clob.setApiCreds(envCreds);
    }

    this.credentials = new CredentialManager({ clobService: this.clob });
    this.gamma = new GammaClient({ config: this.config });
    this.dataApi = new DataApiClient({ config: this.config });
    this.bridge = new BridgeClient({ config: this.config });
    this.relayer = new RelayerClient({
      config: this.config,
      authToken: options.relayerAuthToken,
    });
    this.builder = new BuilderClient({
      clobService: this.clob,
      builderAddress: options.builderAddress,
      builderName: options.builderName,
    });

    this.marketDiscovery = new MarketDiscoveryService({
      gammaClient: this.gamma,
    });
    this.quoteService = new QuoteService({ clobService: this.clob });
    this.positionService = new PositionService({
      clobService: this.clob,
      dataApiClient: this.dataApi,
    });
    this.inventoryService = new InventoryService({
      relayerClient: this.relayer,
      directExecutor: options.directExecutor,
    });
    this.riskEngine = new RiskEngine({
      config: this.config,
      clobService: this.clob,
    });
    this.intentCompiler = new IntentCompiler();

    this.execution = new ExecutionEngine({
      config: this.config,
      compiler: this.intentCompiler,
      riskEngine: this.riskEngine,
      quoteService: this.quoteService,
      clobService: this.clob,
      metrics: this.metrics,
      auditLogger: this.audit,
    });

    this.marketWs = new WsChannelClient({
      config: this.config,
      clobService: this.clob,
      metrics: this.metrics,
    });
    this.userWs = new WsChannelClient({
      config: this.config,
      clobService: this.clob,
      metrics: this.metrics,
    });
    this.sportsWs = new WsChannelClient({
      config: this.config,
      clobService: this.clob,
      metrics: this.metrics,
    });
  }

  async initialize({ autoAuth = true } = {}) {
    if (autoAuth) {
      await this.credentials.validateOrRecover();
    }

    const signer = await this.clob.getSignerAddress();
    this.audit.write("gateway.initialized", {
      signer,
      chainId: this.config.chainId,
    });
    return { signer, chainId: this.config.chainId };
  }

  async discoverMarkets(filters = {}) {
    await this.marketDiscovery.refresh(filters);
    return this.marketDiscovery.search(filters.marketSelector ?? filters);
  }

  async getQuote({ tokenId, side = "BUY" }) {
    return await this.quoteService.getQuote(tokenId, side);
  }

  async resolveOrderMarketContext(intentOrSignal, context = {}) {
    if (!intentOrSignal || typeof intentOrSignal !== "object")
      return intentOrSignal;

    const isSignal = Boolean(intentOrSignal.skillId);
    const normalized = isSignal
      ? {
          ...intentOrSignal,
          marketSelector: {
            ...(intentOrSignal.marketSelector ?? {}),
          },
        }
      : { ...intentOrSignal };

    const selector = isSignal ? normalized.marketSelector : normalized;
    const marketIdRaw = selector.marketId ?? context.marketId;
    let tokenId = selector.tokenId ?? null;
    let conditionId = selector.conditionId ?? null;

    if (
      marketIdRaw !== undefined &&
      marketIdRaw !== null &&
      String(marketIdRaw).trim() !== ""
    ) {
      const marketId = String(marketIdRaw).trim();
      const response = await this.gamma.getMarkets({ id: marketId, limit: 1 });
      const market = Array.isArray(response)
        ? response[0]
        : Array.isArray(response?.data)
          ? response.data[0]
          : null;
      if (!market) {
        throw new ValidationError(
          `Unable to resolve marketId=${marketId} from Gamma markets API`,
        );
      }

      const resolvedConditionId = String(
        market?.conditionId ?? market?.condition_id ?? "",
      ).trim();
      if (!isConditionIdHash(resolvedConditionId)) {
        throw new ValidationError(
          `marketId=${marketId} resolved to invalid conditionId='${resolvedConditionId}'. Expected 0x + 64 hex`,
        );
      }

      const tokenIds = normalizeMarketTokenIds(market);
      if (tokenIds.length === 0) {
        throw new ValidationError(`marketId=${marketId} has no CLOB token ids`);
      }

      if (tokenId) {
        const normalizedTokenId = String(tokenId).trim();
        if (!tokenIds.includes(normalizedTokenId)) {
          throw new ValidationError(
            `tokenId=${normalizedTokenId} does not belong to marketId=${marketId}`,
          );
        }
        tokenId = normalizedTokenId;
      } else if (tokenIds.length === 1) {
        tokenId = tokenIds[0];
      } else {
        throw new ValidationError(
          `marketId=${marketId} maps to multiple tokens (${tokenIds.join(", ")}); tokenId is required`,
        );
      }

      conditionId = resolvedConditionId;
      selector.marketId = marketId;
    }

    if (
      conditionId !== undefined &&
      conditionId !== null &&
      String(conditionId).trim() !== ""
    ) {
      const normalizedConditionId = String(conditionId).trim();
      if (!isConditionIdHash(normalizedConditionId)) {
        throw new ValidationError(
          `conditionId='${normalizedConditionId}' is invalid. Use a 0x + 64-hex conditionId or pass marketId`,
        );
      }
      selector.conditionId = normalizedConditionId;
    }

    if (
      tokenId !== undefined &&
      tokenId !== null &&
      String(tokenId).trim() !== ""
    ) {
      selector.tokenId = String(tokenId).trim();
    }

    return normalized;
  }

  async placeOrder(intentOrSignal, context = {}) {
    const resolvedIntentOrSignal = await this.resolveOrderMarketContext(
      intentOrSignal,
      context,
    );

    if (resolvedIntentOrSignal?.skillId) {
      return await this.execution.executeSkillSignal(
        resolvedIntentOrSignal,
        context,
      );
    }

    const fakeSignal = this.toManualSignal(resolvedIntentOrSignal, context);

    return await this.execution.executeSkillSignal(fakeSignal, {
      ...context,
      postOnly: resolvedIntentOrSignal.postOnly,
      expiration: resolvedIntentOrSignal.expiration,
    });
  }

  async precheckOrder(intentOrSignal, context = {}) {
    const resolvedIntentOrSignal = await this.resolveOrderMarketContext(
      intentOrSignal,
      context,
    );
    const signal = resolvedIntentOrSignal?.skillId
      ? resolvedIntentOrSignal
      : this.toManualSignal(resolvedIntentOrSignal, context);
    const quoteContext = await this.execution.buildQuoteContext(signal);
    const intent = this.intentCompiler.compile(signal, {
      ...context,
      ...quoteContext,
    });
    const normalization = await this.execution.normalizeIntentForMarket(
      intent,
      signal.side,
      {
        retries: 1,
        retryDelayMs: 120,
        priceOffsetTicks: context.marketCrossTicks ?? 3,
        executionMode: context.executionMode,
        marketDefaultTif: context.marketDefaultTif,
      },
    );
    const normalizedIntent = normalization.intent ?? intent;

    if (normalization.blocked) {
      const reasonCode =
        normalization.error?.code ?? "MARKET_METADATA_UNAVAILABLE";
      const riskDecision = {
        decision: RiskDecisionKind.HARD_BLOCK,
        effectiveAction: RiskEffectiveAction.BLOCK,
        reasonCodes: [reasonCode],
        requiredActions: ["Retry after market metadata endpoints recover"],
        diagnostics: {
          metadataRetry:
            normalization.error?.retrySummary ??
            normalization.adjustments?.retries ??
            [],
        },
      };

      return {
        signal,
        intent: normalizedIntent,
        originalIntent: intent,
        riskDecision,
        quoteContext,
        adjustments: normalization.adjustments,
        warnings: uniqueWarnings(normalization.warnings),
      };
    }

    const riskDecision = await this.riskEngine.evaluate(normalizedIntent, {
      skillId: signal.skillId,
      countryCode: context.countryCode,
    });

    return {
      signal,
      intent: normalizedIntent,
      originalIntent: intent,
      riskDecision,
      quoteContext,
      adjustments: normalization.adjustments,
      warnings: uniqueWarnings([
        ...(riskDecision.reasonCodes ?? []),
        ...(normalization.warnings ?? []),
      ]),
    };
  }

  async batchPlaceOrders(
    intents,
    { deferExec = false, defaultPostOnly = false } = {},
  ) {
    const args = intents.map((intent) => ({
      order: this.clob.createOrder(this.clob.toUserOrder(intent)),
      orderType: intent.timeInForce ?? "GTC",
      postOnly: intent.postOnly,
    }));

    const resolved = await Promise.all(
      args.map(async (x) => ({ ...x, order: await x.order })),
    );
    return await this.clob.postOrders(resolved, deferExec, defaultPostOnly);
  }

  async cancel(payload) {
    if (payload?.orderID) return await this.clob.cancelOrder(payload);
    if (payload?.orderIDs)
      return await this.clob.cancelOrders(payload.orderIDs);
    if (payload?.market || payload?.asset_id)
      return await this.clob.cancelMarketOrders(payload);
    if (payload?.all) return await this.clob.cancelAll();
    throw new ValidationError(
      "cancel payload must include orderID, orderIDs, market/asset_id, or all=true",
    );
  }

  async syncOrders(params = {}) {
    const signerAddress = await this.clob.getSignerAddress();
    const defaultAddress = this.clob.funderAddress ?? signerAddress;
    const nextParams =
      params && Object.keys(params).length > 0
        ? params
        : {
            maker_address: defaultAddress,
          };
    return await this.clob.getOpenOrders(nextParams, true);
  }

  async syncTrades(params = {}) {
    const signerAddress = await this.clob.getSignerAddress();
    const defaultAddress = this.clob.funderAddress ?? signerAddress;
    return await this.positionService.syncTrades({
      address: params.address ?? defaultAddress,
      market: params.market,
      assetId: params.assetId,
      before: params.before,
      after: params.after,
    });
  }

  async syncPositions(params = {}) {
    const signerAddress = await this.clob.getSignerAddress();
    const funderAddress = this.clob.funderAddress;

    const requestedAddress = params.address ?? funderAddress ?? signerAddress;
    const includeOpenOrders = Boolean(params.includeOpenOrders);
    const includeClobTrades = Boolean(params.includeClobTrades);
    const includeNotifications = Boolean(params.includeNotifications);
    const useFunderFallback = params.useFunderFallback ?? true;

    const primary = await this.positionService.syncAccountState({
      address: requestedAddress,
      market: params.market,
      assetId: params.assetId,
      includeOpenOrders,
      includeClobTrades,
      includeNotifications,
    });

    const baseResult = {
      ...primary,
      addressRequested: requestedAddress,
      addressUsed: requestedAddress,
      addressFallbackApplied: false,
      funderAddress: funderAddress ?? null,
      signerAddress,
    };

    if (
      !useFunderFallback ||
      !funderAddress ||
      lower(requestedAddress) === lower(funderAddress)
    ) {
      return baseResult;
    }

    if (!looksEmptyPortfolio(primary)) {
      return baseResult;
    }

    try {
      const fallback = await this.positionService.syncAccountState({
        address: funderAddress,
        market: params.market,
        assetId: params.assetId,
        includeOpenOrders,
        includeClobTrades,
        includeNotifications,
      });

      const fallbackWarning = {
        source: "address",
        message: `No portfolio data for requested address ${requestedAddress}; fallback to funder ${funderAddress}`,
      };

      return {
        ...fallback,
        syncIssues: [...(fallback.syncIssues ?? []), fallbackWarning],
        degraded:
          Boolean(fallback.degraded) ||
          Boolean((fallback.syncIssues ?? []).length > 0),
        addressRequested: requestedAddress,
        addressUsed: funderAddress,
        addressFallbackApplied: true,
        funderAddress,
        signerAddress,
      };
    } catch (error) {
      const fallbackWarning = {
        source: "address",
        message: `Requested address ${requestedAddress} returned empty portfolio and fallback to funder ${funderAddress} failed: ${error?.message ?? String(error)}`,
      };
      return {
        ...baseResult,
        syncIssues: [...(baseResult.syncIssues ?? []), fallbackWarning],
        degraded: true,
        addressFallbackApplied: true,
      };
    }
  }

  async manageInventory(action, payload) {
    switch (action) {
      case "approve":
        return await this.inventoryService.approve(payload);
      case "split":
        return await this.inventoryService.split(payload);
      case "merge":
        return await this.inventoryService.merge(payload);
      case "redeem":
        return await this.inventoryService.redeem(payload);
      default:
        throw new ValidationError(`Unsupported inventory action: ${action}`);
    }
  }

  async bridgeFunds(action, payload) {
    switch (action) {
      case "supported-assets":
        return await this.bridge.getSupportedAssets(payload);
      case "quote":
        return await this.bridge.getQuote(payload);
      case "deposit":
        return await this.bridge.createDeposit(payload);
      case "withdraw":
        return await this.bridge.createWithdraw(payload);
      case "status":
        return await this.bridge.getStatus(payload.address, payload.params);
      default:
        throw new ValidationError(`Unsupported bridge action: ${action}`);
    }
  }

  async getMarketDataBatch(params = {}) {
    const tokenIds = asStringArray(params.tokenIds);
    if (tokenIds.length === 0) {
      throw new ValidationError("tokenIds must be a non-empty array");
    }

    const include = mergeIncludeFlags(
      {
        prices: true,
        midpoints: true,
        spreads: true,
        orderBooks: true,
        tickSize: false,
        feeRate: false,
      },
      params.include,
    );

    const side = params.side ?? "BUY";
    const output = {
      tokenIds,
      side,
      include,
      warnings: [],
    };

    if (include.prices) {
      try {
        output.prices = await this.clob.getPrices({
          token_ids: tokenIds,
          side,
        });
      } catch (error) {
        output.warnings.push(
          `prices batch failed: ${error?.message ?? String(error)}`,
        );
        output.prices = await Promise.all(
          tokenIds.map(async (tokenId) => ({
            tokenId,
            value: await this.clob.getPrice(tokenId, side),
          })),
        );
      }
    }

    if (include.midpoints) {
      try {
        output.midpoints = await this.clob.getMidpoints({
          token_ids: tokenIds,
        });
      } catch (error) {
        output.warnings.push(
          `midpoints batch failed: ${error?.message ?? String(error)}`,
        );
        output.midpoints = await Promise.all(
          tokenIds.map(async (tokenId) => ({
            tokenId,
            value: await this.clob.getMidpoint(tokenId),
          })),
        );
      }
    }

    if (include.spreads) {
      try {
        output.spreads = await this.clob.getSpreads({ token_ids: tokenIds });
      } catch (error) {
        output.warnings.push(
          `spreads batch failed: ${error?.message ?? String(error)}`,
        );
        output.spreads = await Promise.all(
          tokenIds.map(async (tokenId) => ({
            tokenId,
            value: await this.clob.getSpread(tokenId),
          })),
        );
      }
    }

    if (include.orderBooks) {
      try {
        output.orderBooks = await this.clob.getOrderBooks({
          token_ids: tokenIds,
        });
      } catch (error) {
        output.warnings.push(
          `orderbooks batch failed: ${error?.message ?? String(error)}`,
        );
        output.orderBooks = await Promise.all(
          tokenIds.map(async (tokenId) => ({
            tokenId,
            value: await this.clob.getOrderBook(tokenId),
          })),
        );
      }
    }

    if (include.tickSize) {
      output.tickSizes = await Promise.all(
        tokenIds.map(async (tokenId) => ({
          tokenId,
          value: await this.clob.getTickSize(tokenId),
        })),
      );
    }

    if (include.feeRate) {
      output.feeRates = await Promise.all(
        tokenIds.map(async (tokenId) => ({
          tokenId,
          value: await this.clob.getFeeRateBps(tokenId),
        })),
      );
    }

    return output;
  }

  async getTradeMeta(params = {}) {
    const action = params.action;
    if (!action) {
      throw new ValidationError("action is required");
    }

    switch (action) {
      case "server_time":
        return await this.clob.getServerTime();
      case "order_scoring": {
        if (Array.isArray(params.orderIds) && params.orderIds.length > 0) {
          return await this.clob.areOrdersScoring({
            orderIds: params.orderIds,
          });
        }
        if (params.orderId) {
          return await this.clob.isOrderScoring({ orderId: params.orderId });
        }
        return await this.clob.isOrderScoring(params.params ?? {});
      }
      case "heartbeat":
        return await this.clob.postHeartbeat(params.heartbeatId);
      case "last_trade":
        if (!params.tokenId)
          throw new ValidationError("tokenId is required for last_trade");
        return await this.clob.getLastTradePrice(params.tokenId);
      case "last_trades":
        if (Array.isArray(params.tokenIds) && params.tokenIds.length > 0) {
          return await this.clob.getLastTradesPrices({
            token_ids: params.tokenIds,
          });
        }
        return await this.clob.getLastTradesPrices(params.params ?? {});
      case "prices_history": {
        const query = params.params ?? {};
        if (!query.token_id && !params.tokenId) {
          throw new ValidationError(
            "tokenId (or params.token_id) is required for prices_history",
          );
        }
        return await this.clob.getPricesHistory({
          ...query,
          ...(params.tokenId ? { token_id: params.tokenId } : {}),
        });
      }
      default:
        throw new ValidationError(`Unsupported trade meta action: ${action}`);
    }
  }

  async getProfileAggregate(params = {}) {
    const address = params.address ?? params.user;
    if (!address) {
      throw new ValidationError("address is required");
    }

    const include = mergeIncludeFlags(
      {
        publicProfile: true,
        positions: true,
        activity: true,
        value: true,
        closedPositions: true,
        traded: true,
      },
      params.include,
    );

    const tasks = [];
    const labels = [];

    if (include.publicProfile) {
      labels.push("publicProfile");
      tasks.push(
        this.gamma.getPublicProfile({
          address,
          ...(params.publicProfileParams ?? {}),
        }),
      );
    }
    if (include.positions) {
      labels.push("positions");
      tasks.push(
        this.dataApi.getPositions({
          user: address,
          ...(params.positionsParams ?? {}),
        }),
      );
    }
    if (include.activity) {
      labels.push("activity");
      tasks.push(
        this.dataApi.getActivity({
          user: address,
          ...(params.activityParams ?? {}),
        }),
      );
    }
    if (include.value) {
      labels.push("value");
      tasks.push(
        this.dataApi.getValue({ user: address, ...(params.valueParams ?? {}) }),
      );
    }
    if (include.closedPositions) {
      labels.push("closedPositions");
      tasks.push(
        this.dataApi.getClosedPositions({
          user: address,
          ...(params.closedPositionsParams ?? {}),
        }),
      );
    }
    if (include.traded) {
      labels.push("traded");
      tasks.push(
        this.dataApi.getTraded({
          user: address,
          ...(params.tradedParams ?? {}),
        }),
      );
    }

    const settled = await Promise.allSettled(tasks);
    const result = {
      address,
      include,
      warnings: [],
    };

    settled.forEach((entry, index) => {
      const key = labels[index];
      if (entry.status === "fulfilled") {
        result[key] = entry.value;
        return;
      }
      result[key] = null;
      result.warnings.push(
        `[${key}] ${entry.reason?.message ?? String(entry.reason)}`,
      );
    });

    return result;
  }

  async getLeaderboard(params = {}) {
    return await this.dataApi.getLeaderboard(params);
  }

  async getBuilderAnalytics(params = {}) {
    const include = mergeIncludeFlags(
      {
        leaderboard: true,
        volume: true,
      },
      params.include,
    );

    const result = {
      include,
      warnings: [],
    };

    if (include.leaderboard) {
      try {
        result.leaderboard = await this.dataApi.getBuildersLeaderboard(
          params.leaderboardParams ?? {},
        );
      } catch (error) {
        result.leaderboard = null;
        result.warnings.push(
          `[leaderboard] ${error?.message ?? String(error)}`,
        );
      }
    }

    if (include.volume) {
      try {
        result.volume = await this.dataApi.getBuildersVolume(
          params.volumeParams ?? {},
        );
      } catch (error) {
        result.volume = null;
        result.warnings.push(`[volume] ${error?.message ?? String(error)}`);
      }
    }

    return result;
  }

  async getEvents(params = {}) {
    const action = params.action ?? "list";
    switch (action) {
      case "list":
        return await this.gamma.getEvents(params.query ?? {});
      case "by_id":
        if (params.id === undefined || params.id === null)
          throw new ValidationError("id is required");
        return await this.gamma.getEventById(params.id, params.query ?? {});
      case "by_slug":
        if (!params.slug) throw new ValidationError("slug is required");
        return await this.gamma.getEventBySlug(params.slug, params.query ?? {});
      case "tags":
        if (params.id === undefined || params.id === null)
          throw new ValidationError("id is required");
        return await this.gamma.getEventTags(params.id, params.query ?? {});
      default:
        throw new ValidationError(`Unsupported events action: ${action}`);
    }
  }

  async getTags(params = {}) {
    const action = params.action ?? "list";
    switch (action) {
      case "list":
        return await this.gamma.getTags(params.query ?? {});
      case "by_id":
        if (params.id === undefined || params.id === null)
          throw new ValidationError("id is required");
        return await this.gamma.getTagById(params.id, params.query ?? {});
      case "by_slug":
        if (!params.slug) throw new ValidationError("slug is required");
        return await this.gamma.getTagBySlug(params.slug, params.query ?? {});
      case "related_relations_by_id":
        if (params.id === undefined || params.id === null)
          throw new ValidationError("id is required");
        return await this.gamma.getTagRelatedRelationsById(
          params.id,
          params.query ?? {},
        );
      case "related_relations_by_slug":
        if (!params.slug) throw new ValidationError("slug is required");
        return await this.gamma.getTagRelatedRelationsBySlug(
          params.slug,
          params.query ?? {},
        );
      case "related_tags_by_id":
        if (params.id === undefined || params.id === null)
          throw new ValidationError("id is required");
        return await this.gamma.getTagRelatedTagsById(
          params.id,
          params.query ?? {},
        );
      case "related_tags_by_slug":
        if (!params.slug) throw new ValidationError("slug is required");
        return await this.gamma.getTagRelatedTagsBySlug(
          params.slug,
          params.query ?? {},
        );
      default:
        throw new ValidationError(`Unsupported tags action: ${action}`);
    }
  }

  async getSeries(params = {}) {
    const action = params.action ?? "list";
    switch (action) {
      case "list":
        return await this.gamma.getSeries(params.query ?? {});
      case "by_id":
        if (params.id === undefined || params.id === null)
          throw new ValidationError("id is required");
        return await this.gamma.getSeriesById(params.id, params.query ?? {});
      default:
        throw new ValidationError(`Unsupported series action: ${action}`);
    }
  }

  async getComments(params = {}) {
    const action = params.action ?? "list";
    switch (action) {
      case "list":
        return await this.gamma.getComments(params.query ?? {});
      case "by_id":
        if (params.id === undefined || params.id === null)
          throw new ValidationError("id is required");
        return await this.gamma.getCommentById(params.id, params.query ?? {});
      case "by_user_address":
        if (!params.userAddress)
          throw new ValidationError("userAddress is required");
        return await this.gamma.getCommentsByUserAddress(
          params.userAddress,
          params.query ?? {},
        );
      default:
        throw new ValidationError(`Unsupported comments action: ${action}`);
    }
  }

  async getSportsMeta(params = {}) {
    const action = params.action ?? "sports";
    switch (action) {
      case "sports":
        return await this.gamma.getSportsMeta(params.query ?? {});
      case "market_types":
        return await this.gamma.getSportsMarketTypes(params.query ?? {});
      case "teams":
        return await this.gamma.getTeams(params.query ?? {});
      default:
        throw new ValidationError(`Unsupported sports action: ${action}`);
    }
  }

  async connectMarketStream(subscription, handlers = {}) {
    await this.connectWsStream("market", subscription, handlers);
  }

  async connectUserStream(subscription, handlers = {}) {
    await this.connectWsStream("user", subscription, handlers);
  }

  async connectSportsStream(subscription, handlers = {}) {
    await this.connectWsStream("sports", subscription, handlers);
  }

  async connectWsStream(channel, subscription = {}, handlers = {}) {
    const client = this.getWsClient(channel);
    this.attachWsHandlers(client, handlers);
    await client.connect(channel, subscription);
  }

  async disconnectWsStream(channel = undefined) {
    if (channel) {
      await this.getWsClient(channel).disconnect();
      return;
    }
    await Promise.all([
      this.marketWs.disconnect(),
      this.userWs.disconnect(),
      this.sportsWs.disconnect(),
    ]);
  }

  async disconnectStreams() {
    await this.disconnectWsStream();
  }

  getWsClient(channel) {
    switch (channel) {
      case "market":
        return this.marketWs;
      case "user":
        return this.userWs;
      case "sports":
        return this.sportsWs;
      default:
        throw new ValidationError(`Unsupported ws channel: ${channel}`);
    }
  }

  attachWsHandlers(client, handlers) {
    if (handlers.onEvent) client.on("event", handlers.onEvent);
    if (handlers.onError) client.on("error", handlers.onError);
    if (handlers.onConnected) client.on("connected", handlers.onConnected);
    if (handlers.onDisconnected)
      client.on("disconnected", handlers.onDisconnected);
  }

  metricsSnapshot() {
    return this.metrics.snapshot();
  }

  toManualSignal(intentOrSignal, context = {}) {
    const orderType = intentOrSignal.orderType ?? "LIMIT";
    const priceMode = orderType === "MARKET" ? "best_effort" : "limit";
    const sizeValue =
      orderType === "MARKET"
        ? Number(intentOrSignal.amount ?? intentOrSignal.size ?? 0)
        : Number(intentOrSignal.size ?? 0);
    return {
      skillId: context.skillId ?? "manual",
      intentType: orderType,
      marketSelector: {
        tokenId: intentOrSignal.tokenId,
        conditionId: intentOrSignal.conditionId,
        marketId: intentOrSignal.marketId ?? context.marketId,
      },
      side: intentOrSignal.side,
      sizePolicy: { mode: "fixed", value: sizeValue },
      pricePolicy: {
        mode: priceMode,
        value: intentOrSignal.limitPrice,
      },
      riskPolicy: context.riskPolicy ?? {},
      timeInForce: intentOrSignal.timeInForce ?? "GTC",
    };
  }
}
