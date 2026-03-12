export const RiskDecisionKind = Object.freeze({
  ALLOW: "ALLOW",
  SOFT_BLOCK: "SOFT_BLOCK",
  HARD_BLOCK: "HARD_BLOCK",
});

export const RiskEffectiveAction = Object.freeze({
  CONTINUE: "CONTINUE",
  BLOCK: "BLOCK",
});

export const IntentType = Object.freeze({
  LIMIT: "LIMIT",
  MARKET: "MARKET",
});

export const TradeSide = Object.freeze({
  BUY: "BUY",
  SELL: "SELL",
});

/**
 * @typedef {Object} SkillSignal
 * @property {string} skillId
 * @property {"LIMIT"|"MARKET"} intentType
 * @property {{tokenId?: string, conditionId?: string, marketId?: string|number, tags?: string[], eventSlug?: string, query?: string}} marketSelector
 * @property {"BUY"|"SELL"} side
 * @property {{mode: "fixed"|"percent_balance", value: number}} sizePolicy
 * @property {{mode: "limit"|"midpoint_offset"|"best_effort", value?: number}} pricePolicy
 * @property {{maxNotionalUsd?: number, maxSlippageBps?: number, requireManualConfirm?: boolean}} riskPolicy
 * @property {"GTC"|"GTD"|"FOK"|"FAK"} timeInForce
 */

/**
 * @typedef {Object} TradeIntent
 * @property {string} tokenId
 * @property {string=} conditionId
 * @property {string|number=} marketId
 * @property {"BUY"|"SELL"} side
 * @property {"LIMIT"|"MARKET"} orderType
 * @property {number=} size
 * @property {number=} amount
 * @property {number=} limitPrice
 * @property {number=} expiration
 * @property {boolean=} postOnly
 * @property {Object=} raw
 */

/**
 * @typedef {Object} ExecutionPlan
 * @property {Array<Object>} preChecks
 * @property {Array<TradeIntent>} orders
 * @property {Array<string>} cancelRules
 * @property {Array<string>} fallbackRules
 * @property {number} maxRetries
 */

/**
 * @typedef {Object} ExecutionResult
 * @property {boolean} accepted
 * @property {Array<string>} orderIds
 * @property {Array<string>} tradeIds
 * @property {string} finalStatus
 * @property {string=} errorCode
 * @property {Array<string>=} warnings
 * @property {any=} rawExchangePayload
 */

/**
 * @typedef {Object} RiskDecision
 * @property {"ALLOW"|"SOFT_BLOCK"|"HARD_BLOCK"} decision
 * @property {"CONTINUE"|"BLOCK"} effectiveAction
 * @property {Array<string>} reasonCodes
 * @property {Array<string>} requiredActions
 * @property {Object=} diagnostics
 */

export function normalizeApiCreds(creds) {
  if (!creds || typeof creds !== "object") {
    return { key: "", secret: "", passphrase: "" };
  }

  return {
    key: creds.key ?? creds.apiKey ?? "",
    secret: creds.secret ?? "",
    passphrase: creds.passphrase ?? "",
  };
}

export function hasApiCreds(creds) {
  const normalized = normalizeApiCreds(creds);
  return Boolean(normalized.key && normalized.secret && normalized.passphrase);
}

export function normalizeBalanceAllowance(response) {
  if (!response || typeof response !== "object") {
    return { balance: "0", allowances: {} };
  }

  const allowances = response.allowances ?? (response.allowance ? { default: response.allowance } : {});

  return {
    balance: String(response.balance ?? "0"),
    allowances,
  };
}

export function assertSkillSignal(signal) {
  if (!signal || typeof signal !== "object") throw new Error("SkillSignal must be an object");
  if (!signal.skillId) throw new Error("SkillSignal.skillId is required");
  if (!Object.values(IntentType).includes(signal.intentType)) {
    throw new Error(`SkillSignal.intentType must be one of: ${Object.values(IntentType).join(", ")}`);
  }
  if (!Object.values(TradeSide).includes(signal.side)) {
    throw new Error(`SkillSignal.side must be one of: ${Object.values(TradeSide).join(", ")}`);
  }
  if (!signal.marketSelector || typeof signal.marketSelector !== "object") {
    throw new Error("SkillSignal.marketSelector is required");
  }
  if (!signal.sizePolicy || typeof signal.sizePolicy?.value !== "number") {
    throw new Error("SkillSignal.sizePolicy.value must be provided as number");
  }
}

export function buildRiskDecision(
  decision,
  reasonCodes = [],
  requiredActions = [],
  diagnostics = undefined,
  effectiveAction = decision === RiskDecisionKind.HARD_BLOCK ? RiskEffectiveAction.BLOCK : RiskEffectiveAction.CONTINUE,
) {
  return {
    decision,
    effectiveAction,
    reasonCodes,
    requiredActions,
    diagnostics,
  };
}
