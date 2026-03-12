import { randomUUID } from "node:crypto";
import { classifyMcpError } from "./errorCodes.mjs";

export function createTraceId() {
  return randomUUID();
}

export function toMcpOk(data, { traceId = createTraceId(), warnings = [] } = {}) {
  const payload = {
    ok: true,
    data,
    traceId,
  };

  if (Array.isArray(warnings) && warnings.length > 0) {
    payload.warnings = warnings;
  }

  return payload;
}

export function toMcpErr(error, { traceId = createTraceId(), code = undefined, details = undefined } = {}) {
  const resolvedCode = code ?? classifyMcpError(error);
  const message = error?.message ?? String(error ?? "Unknown error");

  return {
    ok: false,
    traceId,
    error: {
      code: resolvedCode,
      message,
      details: details ?? error?.details,
    },
  };
}
