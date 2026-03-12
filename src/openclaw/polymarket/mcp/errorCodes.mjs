import { AuthError, PolymarketError, RiskBlockedError, ValidationError } from "../errors.mjs";

export const McpErrorCode = Object.freeze({
  AUTH_INVALID_KEY: "AUTH_INVALID_KEY",
  RISK_HARD_BLOCK: "RISK_HARD_BLOCK",
  RISK_SOFT_BLOCK: "RISK_SOFT_BLOCK",
  ORDER_REJECTED: "ORDER_REJECTED",
  ORDER_SUBMISSION_UNCONFIRMED: "ORDER_SUBMISSION_UNCONFIRMED",
  RATE_LIMITED: "RATE_LIMITED",
  UPSTREAM_UNAVAILABLE: "UPSTREAM_UNAVAILABLE",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  NOT_ENABLED_IN_PHASE1: "NOT_ENABLED_IN_PHASE1",
});

function getRiskDecision(error) {
  return (
    error?.details?.riskDecision ??
    error?.details?.rawExchangePayload?.riskDecision ??
    error?.details?.result?.rawExchangePayload?.riskDecision
  );
}

function getRiskErrorCode(error) {
  return (
    error?.details?.errorCode ??
    error?.details?.code ??
    error?.details?.result?.errorCode ??
    error?.details?.result?.rawExchangePayload?.errorCode
  );
}

function messageHintsAuth(message) {
  const text = String(message ?? "").toLowerCase();
  return (
    text.includes("unauthorized") ||
    text.includes("invalid api key") ||
    text.includes("api key") ||
    text.includes("passphrase")
  );
}

export function classifyMcpError(error, fallbackCode = McpErrorCode.ORDER_REJECTED) {
  if (error instanceof ValidationError) return McpErrorCode.VALIDATION_FAILED;
  if (error instanceof AuthError) return McpErrorCode.AUTH_INVALID_KEY;

  if (error instanceof RiskBlockedError) {
    const riskCode = getRiskErrorCode(error);
    if (riskCode === McpErrorCode.ORDER_SUBMISSION_UNCONFIRMED) {
      return McpErrorCode.ORDER_SUBMISSION_UNCONFIRMED;
    }
    const decision = getRiskDecision(error)?.decision;
    if (decision === "HARD_BLOCK") return McpErrorCode.RISK_HARD_BLOCK;
    if (decision === "SOFT_BLOCK") return McpErrorCode.RISK_SOFT_BLOCK;
    return McpErrorCode.ORDER_REJECTED;
  }

  const status = Number(error?.status ?? error?.details?.status ?? 0);
  if (status === 401 || status === 403) return McpErrorCode.AUTH_INVALID_KEY;
  if (status === 429) return McpErrorCode.RATE_LIMITED;

  if (error instanceof PolymarketError) {
    if (status >= 500 || status === 0) return McpErrorCode.UPSTREAM_UNAVAILABLE;
    if (messageHintsAuth(error.message)) return McpErrorCode.AUTH_INVALID_KEY;
  }

  if (messageHintsAuth(error?.message)) return McpErrorCode.AUTH_INVALID_KEY;

  return fallbackCode;
}
