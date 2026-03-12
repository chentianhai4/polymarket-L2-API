import { assertSkillSignal, IntentType } from "../types.mjs";

function resolveSize(sizePolicy, quoteContext = {}) {
  if (sizePolicy.mode === "fixed") return sizePolicy.value;
  if (sizePolicy.mode === "percent_balance") {
    const balance = Number(quoteContext.balanceUsd ?? 0);
    const price = Number(quoteContext.referencePrice ?? 0);
    if (!balance || !price) return 0;
    const notional = balance * (sizePolicy.value / 100);
    return notional / price;
  }
  return sizePolicy.value;
}

function resolvePrice(signal, quoteContext = {}) {
  const midpoint = Number(quoteContext.midpoint ?? 0);
  const bestPrice = Number(quoteContext.bestPrice ?? midpoint);

  if (signal.intentType === IntentType.MARKET) {
    return undefined;
  }

  switch (signal.pricePolicy?.mode) {
    case "limit":
      return Number(signal.pricePolicy.value);
    case "midpoint_offset": {
      const offset = Number(signal.pricePolicy.value ?? 0);
      return midpoint + offset;
    }
    case "best_effort":
    default:
      return bestPrice;
  }
}

export class IntentCompiler {
  compile(signal, context = {}) {
    assertSkillSignal(signal);

    const tokenId = signal.marketSelector.tokenId;
    if (!tokenId) {
      throw new Error("SkillSignal.marketSelector.tokenId is required for execution");
    }

    const resolvedQuantity = resolveSize(signal.sizePolicy, context);
    const limitPrice = resolvePrice(signal, context);
    const isMarket = signal.intentType === IntentType.MARKET;

    return {
      tokenId,
      conditionId: signal.marketSelector.conditionId,
      marketId: signal.marketSelector.marketId,
      side: signal.side,
      orderType: signal.intentType,
      size: isMarket ? undefined : resolvedQuantity,
      amount: isMarket ? resolvedQuantity : undefined,
      limitPrice,
      expiration: context.expiration,
      postOnly: Boolean(context.postOnly),
      timeInForce: signal.timeInForce,
      riskPolicy: signal.riskPolicy,
      raw: {
        skillId: signal.skillId,
        marketSelector: signal.marketSelector,
      },
    };
  }
}
