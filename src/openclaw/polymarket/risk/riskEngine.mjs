import { AssetType } from "@polymarket/clob-client";
import { RiskDecisionKind, RiskEffectiveAction, buildRiskDecision } from "../types.mjs";

function dayKey(timestamp = Date.now()) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function usdcUnitsToAmount(units) {
  const n = Number(units);
  if (!Number.isFinite(n)) return 0;
  return n / 1_000_000;
}

function extractTickSize(orderBook) {
  return (
    toNumber(orderBook?.tick_size, NaN) ||
    toNumber(orderBook?.tickSize, NaN) ||
    toNumber(orderBook?.minimum_tick_size, NaN) ||
    toNumber(orderBook?.min_tick_size, NaN)
  );
}

function extractMinOrderSize(orderBook, fallback) {
  const fromBook =
    toNumber(orderBook?.min_order_size, NaN) ||
    toNumber(orderBook?.minOrderSize, NaN) ||
    toNumber(orderBook?.minimum_order_size, NaN);
  return Number.isFinite(fromBook) && fromBook > 0 ? fromBook : fallback;
}

function extractBestAsk(orderBook) {
  const asks = Array.isArray(orderBook?.asks) ? orderBook.asks : [];
  let best = null;
  for (const level of asks) {
    const value = level?.price ?? level?.p ?? (Array.isArray(level) ? level[0] : null);
    const n = toNumber(value, NaN);
    if (!Number.isFinite(n)) continue;
    if (best === null || n < best) best = n;
  }
  return best;
}

export class RiskEngine {
  constructor({ config, clobService }) {
    this.config = config;
    this.clob = clobService;
    this.killSwitch = false;
    this.usage = {
      skillDailyNotional: new Map(),
      marketDailyNotional: new Map(),
    };
  }

  async withSoftTimeout(promise, timeoutMs, fallback = null) {
    let timer = null;
    const timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } catch {
      return fallback;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  setKillSwitch(enabled) {
    this.killSwitch = Boolean(enabled);
  }

  usageKey(scope, id) {
    return `${scope}:${id}:${dayKey()}`;
  }

  getUsage(map, key) {
    return map.get(key) ?? 0;
  }

  addUsage(map, key, amount) {
    map.set(key, this.getUsage(map, key) + amount);
  }

  recordFilledIntent(skillId, marketId, notionalUsd) {
    const skillKey = this.usageKey("skill", skillId);
    this.addUsage(this.usage.skillDailyNotional, skillKey, notionalUsd);

    if (marketId) {
      const marketKey = this.usageKey("market", marketId);
      this.addUsage(this.usage.marketDailyNotional, marketKey, notionalUsd);
    }
  }

  async evaluate(intent, context = {}) {
    if (this.killSwitch) {
      return buildRiskDecision(
        RiskDecisionKind.HARD_BLOCK,
        ["KILL_SWITCH"],
        ["Disable kill switch before trading"],
        undefined,
        RiskEffectiveAction.BLOCK,
      );
    }

    const reasonCodes = [];
    const requiredActions = [];
    const diagnostics = {};

    const country = context.countryCode?.toUpperCase?.();
    const allow = this.config.geoAllowedCountries;
    const deny = this.config.geoDeniedCountries;

    if (Array.isArray(allow) && allow.length > 0 && country && !allow.includes(country)) {
      reasonCodes.push("COUNTRY_NOT_ALLOWED");
      requiredActions.push("Route execution to allowed jurisdiction");
    }

    if (Array.isArray(deny) && deny.length > 0 && country && deny.includes(country)) {
      reasonCodes.push("COUNTRY_DENIED");
      requiredActions.push("Block execution due to geoblock policy");
    }

    // Keep precheck responsive in constrained proxy networks: once this budget is hit,
    // treat upstream data as unavailable and continue with warn/block decision logic.
    const precheckBudgetMs = Math.min(12000, Math.max(2000, Math.floor(toNumber(this.config.requestTimeoutMs, 30000) * 0.4)));

    const [banStatus, quote, feeRate, negRisk, balanceResp] = await Promise.all([
      this.withSoftTimeout(this.clob.getClosedOnlyMode(), precheckBudgetMs, null),
      this.withSoftTimeout(this.clob.getOrderBook(intent.tokenId), precheckBudgetMs, null),
      this.withSoftTimeout(this.clob.getFeeRateBps(intent.tokenId), precheckBudgetMs, null),
      this.withSoftTimeout(this.clob.getNegRisk(intent.tokenId), precheckBudgetMs, null),
      this.withSoftTimeout(this.clob.getBalanceAllowance({ asset_type: AssetType.COLLATERAL }), precheckBudgetMs, null),
    ]);

    diagnostics.closedOnly = banStatus?.closed_only;
    if (banStatus?.closed_only) {
      reasonCodes.push("ACCOUNT_CLOSED_ONLY_MODE");
      requiredActions.push("Do not place new opening positions");
    }

    const tickSize = extractTickSize(quote);
    const minOrderSize = extractMinOrderSize(quote, this.config.minOrderSize);

    diagnostics.tickSize = tickSize;
    diagnostics.minOrderSize = minOrderSize;

    const isMarket = String(intent.orderType ?? "LIMIT").toUpperCase() === "MARKET";
    const side = String(intent.side ?? "BUY").toUpperCase();
    const size = toNumber(intent.size, 0);
    const amount = toNumber(intent.amount, 0);
    const bestAsk = extractBestAsk(quote);
    diagnostics.bestAsk = bestAsk;

    if (!isMarket) {
      if (size < minOrderSize) {
        reasonCodes.push("ORDER_SIZE_BELOW_MIN");
        requiredActions.push(`Increase size to >= ${minOrderSize}`);
      }
    } else if (side === "SELL") {
      if (amount < minOrderSize) {
        reasonCodes.push("ORDER_SIZE_BELOW_MIN");
        requiredActions.push(`Increase SELL amount(shares) to >= ${minOrderSize}`);
      }
    } else if (Number.isFinite(bestAsk) && bestAsk > 0) {
      const estimatedShares = amount / bestAsk;
      diagnostics.marketBuyEstimatedShares = estimatedShares;
      if (estimatedShares < minOrderSize) {
        reasonCodes.push("ORDER_SIZE_BELOW_MIN");
        requiredActions.push(`Increase BUY amount(USDC) so amount/bestAsk >= ${minOrderSize}`);
      }
    }

    const limitPrice = toNumber(intent.limitPrice, NaN);
    if (Number.isFinite(tickSize) && Number.isFinite(limitPrice)) {
      const rounded = Math.round(limitPrice / tickSize) * tickSize;
      const diff = Math.abs(rounded - limitPrice);
      if (diff > tickSize / 1000) {
        reasonCodes.push("PRICE_NOT_ON_TICK");
        requiredActions.push(`Adjust price to tick size ${tickSize}`);
      }
    }

    diagnostics.feeRateBps = feeRate;
    if (feeRate === null || feeRate === undefined) {
      reasonCodes.push("FEE_RATE_UNAVAILABLE");
      requiredActions.push("Retry after fee-rate lookup succeeds");
    }

    diagnostics.negRisk = negRisk;
    if (negRisk === null || negRisk === undefined) {
      reasonCodes.push("NEG_RISK_UNAVAILABLE");
      requiredActions.push("Retry after neg-risk lookup succeeds");
    }

    const balance = usdcUnitsToAmount(balanceResp?.balance);
    diagnostics.collateralBalance = balance;

    let notional = size * toNumber(intent.limitPrice ?? intent.referencePrice ?? 0, 0);
    if (isMarket) {
      if (side === "BUY") {
        notional = amount;
      } else {
        notional = amount * toNumber(intent.limitPrice ?? intent.referencePrice ?? 0, 0);
      }
    }
    diagnostics.notional = notional;

    if (balanceResp) {
      const allowances = balanceResp.allowances ?? {};
      if (Object.keys(allowances).length === 0) {
        reasonCodes.push("ALLOWANCE_MISSING");
        requiredActions.push("Call updateBalanceAllowance/approve before trading");
      }
    } else {
      reasonCodes.push("BALANCE_LOOKUP_FAILED");
      requiredActions.push("Retry balance/allowance precheck");
    }

    if (notional > this.config.risk.maxNotionalUsdPerOrder) {
      reasonCodes.push("MAX_NOTIONAL_PER_ORDER_EXCEEDED");
      requiredActions.push("Reduce order notional");
    }

    const skillKey = this.usageKey("skill", context.skillId ?? "unknown");
    const marketKey = this.usageKey("market", intent.conditionId ?? intent.tokenId);

    const skillUsed = this.getUsage(this.usage.skillDailyNotional, skillKey);
    const marketUsed = this.getUsage(this.usage.marketDailyNotional, marketKey);

    diagnostics.skillUsedToday = skillUsed;
    diagnostics.marketUsedToday = marketUsed;

    if (skillUsed + notional > this.config.risk.maxNotionalUsdPerSkillPerDay) {
      reasonCodes.push("MAX_NOTIONAL_PER_SKILL_PER_DAY_EXCEEDED");
      requiredActions.push("Reduce skill-level exposure");
    } else if (skillUsed + notional >= this.config.risk.maxNotionalUsdPerSkillPerDay * 0.8) {
      reasonCodes.push("SKILL_BUDGET_NEAR_LIMIT");
      requiredActions.push("Skill budget is near limit");
    }

    if (marketUsed + notional > this.config.risk.maxNotionalUsdPerMarketPerDay) {
      reasonCodes.push("MAX_NOTIONAL_PER_MARKET_PER_DAY_EXCEEDED");
      requiredActions.push("Reduce market-level exposure");
    } else if (marketUsed + notional >= this.config.risk.maxNotionalUsdPerMarketPerDay * 0.8) {
      reasonCodes.push("MARKET_BUDGET_NEAR_LIMIT");
      requiredActions.push("Market budget is near limit");
    }

    if (reasonCodes.length === 0) {
      return buildRiskDecision(RiskDecisionKind.ALLOW, [], [], diagnostics, RiskEffectiveAction.CONTINUE);
    }

    const hardBlockCodes = new Set([
      "KILL_SWITCH",
      "COUNTRY_DENIED",
      "COUNTRY_NOT_ALLOWED",
      "ACCOUNT_CLOSED_ONLY_MODE",
      "ORDER_SIZE_BELOW_MIN",
      "PRICE_NOT_ON_TICK",
      "ALLOWANCE_MISSING",
      "BALANCE_LOOKUP_FAILED",
      "MAX_NOTIONAL_PER_ORDER_EXCEEDED",
      "MAX_NOTIONAL_PER_SKILL_PER_DAY_EXCEEDED",
      "MAX_NOTIONAL_PER_MARKET_PER_DAY_EXCEEDED",
    ]);

    const hasHardBlock = reasonCodes.some((code) => hardBlockCodes.has(code));
    const decision = hasHardBlock ? RiskDecisionKind.HARD_BLOCK : RiskDecisionKind.SOFT_BLOCK;
    const mode = this.config?.risk?.enforcementMode ?? "warn-only";
    const effectiveAction =
      decision === RiskDecisionKind.HARD_BLOCK || mode === "block-all"
        ? RiskEffectiveAction.BLOCK
        : RiskEffectiveAction.CONTINUE;

    return buildRiskDecision(decision, reasonCodes, requiredActions, diagnostics, effectiveAction);
  }
}
