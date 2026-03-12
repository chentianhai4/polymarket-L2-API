#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/wangchenxiong/Desktop/polymarket L2 API"
CALL="$ROOT/scripts/pm_mcp_call.sh"
REPORT="$ROOT/MCP_TOOL_VALIDATION_2026-02-18_REVALIDATED.md"

export MCPORTER_CALL_TIMEOUT="90000"
export POLYMARKET_REQUEST_TIMEOUT_MS="90000"

json_pretty() {
  node - <<'NODE'
const fs = require('fs');
const txt = fs.readFileSync(0,'utf8').trim();
try { console.log(JSON.stringify(JSON.parse(txt), null, 2)); }
catch { console.log(JSON.stringify({ raw: txt }, null, 2)); }
NODE
}

millis() { python3 - <<'PY'
import time
print(int(time.time()*1000))
PY
}

# 1) Discover a tokenId/conditionId we can use for quote/precheck.
DISCOVER_OUT=$(bash "$CALL" pm_market_discover '{"limit":1,"active":true}')
TOKEN_ID=$(node -e 'const d=JSON.parse(process.argv[1]); const m=d.data.markets[0]; let ids=m.clobTokenIds ?? m.clob_token_ids; if(typeof ids==="string"){ try{ids=JSON.parse(ids)}catch{ids=[]} } if(Array.isArray(ids)&&ids.length) console.log(String(ids[0])); else console.log("");' "$DISCOVER_OUT")
COND_ID=$(node -e 'const d=JSON.parse(process.argv[1]); const m=d.data.markets[0]; console.log(String(m.conditionId ?? m.condition_id ?? ""));' "$DISCOVER_OUT")

BOOTSTRAP_OUT=$(bash "$CALL" pm_auth_bootstrap '{"autoAuth":true}')
SIGNER=$(node -e 'const d=JSON.parse(process.argv[1]); console.log(String(d.data.signer||""));' "$BOOTSTRAP_OUT")

if [[ -z "$TOKEN_ID" ]]; then
  echo "[validate] ERROR: tokenId empty from pm_market_discover" >&2
  exit 1
fi

INTENT=$(node -e 'console.log(JSON.stringify({tokenId:process.argv[1],conditionId:process.argv[2]||undefined,side:"BUY",orderType:"LIMIT",size:1,limitPrice:0.5,timeInForce:"GTC",postOnly:true}))' "$TOKEN_ID" "$COND_ID")
CONTEXT=$(node -e 'console.log(JSON.stringify({skillId:"mcp-revalidate",countryCode:"SG",idempotencyKey:`mcp-revalidate:${process.argv[1]}`}))' "$TOKEN_ID")

# args map (bash 3.2 compatible: no associative arrays)
TOOLS=(
  pm_auth_bootstrap
  pm_auth_validate
  pm_market_discover
  pm_quote_get
  pm_balance_get
  pm_precheck_order
  pm_order_place
  pm_order_batch_place
  pm_order_cancel
  pm_order_cancel_all
  pm_sync_orders
  pm_sync_trades
  pm_sync_positions
  pm_metrics_snapshot
)

get_args() {
  local tool="$1"
  case "$tool" in
    pm_auth_bootstrap) echo '{"autoAuth":true}' ;;
    pm_auth_validate) echo '{"recover":true}' ;;
    pm_market_discover) echo '{"limit":1,"active":true}' ;;
    pm_quote_get) node -e 'console.log(JSON.stringify({tokenId:process.argv[1],side:"BUY"}))' "$TOKEN_ID" ;;
    pm_balance_get) echo '{"assetType":"COLLATERAL","updateFirst":false}' ;;
    pm_precheck_order) node -e 'console.log(JSON.stringify({intent:JSON.parse(process.argv[1]),context:JSON.parse(process.argv[2])}))' "$INTENT" "$CONTEXT" ;;
    pm_order_place) node -e 'console.log(JSON.stringify({intent:JSON.parse(process.argv[1]),context:JSON.parse(process.argv[2]),dryRun:true}))' "$INTENT" "$CONTEXT" ;;
    pm_order_batch_place) node -e 'console.log(JSON.stringify({intents:[JSON.parse(process.argv[1])],dryRun:true}))' "$INTENT" ;;
    pm_order_cancel) echo '{"payload":{"all":true},"dryRun":true}' ;;
    pm_order_cancel_all) echo '{"dryRun":true}' ;;
    pm_sync_orders) echo '{"params":{}}' ;;
    pm_sync_trades) echo '{"params":{}}' ;;
    pm_sync_positions) node -e 'console.log(JSON.stringify({params:{address:process.argv[1],includeOpenOrders:false,includeClobTrades:false,includeNotifications:false}}))' "$SIGNER" ;;
    pm_metrics_snapshot) echo '{}' ;;
    *) echo '{}' ;;
  esac
}

# write header
{
  echo "# Polymarket MCP 工具调用验证报告（重启后复验）"
  echo ""
  echo "- 时间: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "- 目录: $ROOT"
  echo "- 执行方式: bash pm_mcp_call.sh -> mcporter call --stdio"
  echo "- 超时: MCPORTER_CALL_TIMEOUT=$MCPORTER_CALL_TIMEOUT, POLYMARKET_REQUEST_TIMEOUT_MS=$POLYMARKET_REQUEST_TIMEOUT_MS"
  echo "- tokenId: $TOKEN_ID"
  echo "- conditionId: $COND_ID"
  echo "- signer: $SIGNER"
  echo ""
  echo "注意：交易/撤单相关工具使用 dryRun=true，不会真实下单/撤单。"
  echo ""
  echo "## 汇总"
  echo ""
} > "$REPORT"

ok_count=0
err_count=0

for tool in "${TOOLS[@]}"; do
  args=$(get_args "$tool")
  start=$(millis)
  # capture stdout+stderr; preserve command success via parsing json
  out=$(bash "$CALL" "$tool" "$args" 2>&1 || true)
  end=$(millis)
  elapsed=$((end-start))

  status=$(node -e 'const fs=require("fs"); const txt=fs.readFileSync(0,"utf8").trim(); try{const j=JSON.parse(txt); process.stdout.write(j.ok?"OK":"ERR");}catch{process.stdout.write("ERR");}' <<<"$out")
  if [[ "$status" == "OK" ]]; then ok_count=$((ok_count+1)); else err_count=$((err_count+1)); fi

  echo "- \`$tool\` => **$status** (${elapsed}ms) args=\`$args\`" >> "$REPORT"

  {
    echo ""
    echo "---"
    echo ""
    echo "### $tool — $status"
    echo ""
    echo "Args: \`$args\`"
    echo ""
    echo "Output:"
    echo ""
    echo "\`\`\`json"
    printf "%s" "$out" | json_pretty
    echo "\`\`\`"
  } >> "$REPORT"

done

# insert counts after summary header
perl -0777 -i -pe 's/(## 汇总\n\n)/$1."- 统计: OK='"$ok_count"', ERR='"$err_count"'\n\n"/e' "$REPORT"

echo "[validate] written: $REPORT"

# exit non-zero if any errors
if [[ "$err_count" -gt 0 ]]; then
  exit 2
fi
