#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." >/dev/null 2>&1 && pwd)"
SERVER_CMD="$(printf 'node %q' "${ROOT_DIR}/bin/pm_mcp_stdio.mjs")"

cd "${ROOT_DIR}"
export POLYMARKET_ENV_PATH="${ROOT_DIR}/.env"
export MCPORTER_CALL_TIMEOUT="${MCPORTER_CALL_TIMEOUT:-30000}"
export POLYMARKET_REQUEST_TIMEOUT_MS="${POLYMARKET_REQUEST_TIMEOUT_MS:-30000}"

if ! command -v mcporter >/dev/null 2>&1; then
  echo "mcporter not found. Install with: npm i -g mcporter" >&2
  exit 1
fi

if [[ $# -lt 1 ]]; then
  cat >&2 <<USAGE
Usage:
  bash ./scripts/pm_mcp_call.sh <tool_name> [json_args]

Examples:
  bash ./scripts/pm_mcp_call.sh pm_metrics_snapshot '{}'
  bash ./scripts/pm_mcp_call.sh pm_quote_get '{"tokenId":"123","side":"BUY"}'
USAGE
  exit 1
fi

TOOL_NAME="$1"
JSON_ARGS='{}'
if [[ $# -ge 2 ]]; then
  JSON_ARGS="$2"
fi

mcporter call --stdio "${SERVER_CMD}" "${TOOL_NAME}" --args "${JSON_ARGS}"
