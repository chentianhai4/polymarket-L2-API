#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

HOST="${HOST:-https://clob.polymarket.com}"
CHAIN_ID="${CHAIN_ID:-137}"
SIGNATURE_TYPE="${SIGNATURE_TYPE:-2}"
ASSET_TYPE="${ASSET_TYPE:-COLLATERAL}"

required_vars=(PRIVATE_KEY API_KEY SECRET PASSPHRASE FUNDER_ADDRESS)
for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "Missing ${var_name} in .env or environment" >&2
    exit 1
  fi
done

if ! command -v node >/dev/null 2>&1; then
  echo "node is required" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi

request_json() {
  local method="$1"
  local url="$2"
  shift 2
  local raw
  raw="$(curl -sS -X "$method" "$url" "$@" -w $'\n%{http_code}')"
  HTTP_STATUS="${raw##*$'\n'}"
  HTTP_BODY="${raw%$'\n'*}"
}

pretty_print_json_or_raw() {
  node --input-type=module -e '
const raw = process.argv[1] ?? "";
try {
  const parsed = JSON.parse(raw);
  console.log(JSON.stringify(parsed, null, 2));
} catch {
  console.log(raw);
}
' "$1"
}

make_l2_headers() {
  local request_path="$1"
  eval "$(REQUEST_PATH="$request_path" CHAIN_ID="$CHAIN_ID" node --input-type=module <<'NODE'
import { Wallet } from "ethers";
import { createL2Headers } from "@polymarket/clob-client/dist/headers/index.js";

const signer = new Wallet(process.env.PRIVATE_KEY);
const creds = {
  key: process.env.API_KEY,
  secret: process.env.SECRET,
  passphrase: process.env.PASSPHRASE,
};
const headers = await createL2Headers(signer, creds, {
  method: "GET",
  requestPath: process.env.REQUEST_PATH,
});

for (const [k, v] of Object.entries(headers)) {
  console.log(`L2_${k}=${JSON.stringify(v)}`);
}
NODE
)"
}

make_l2_headers "/balance-allowance/update"
request_json GET "${HOST}/balance-allowance/update" \
  -H "POLY_ADDRESS: ${L2_POLY_ADDRESS}" \
  -H "POLY_SIGNATURE: ${L2_POLY_SIGNATURE}" \
  -H "POLY_TIMESTAMP: ${L2_POLY_TIMESTAMP}" \
  -H "POLY_API_KEY: ${L2_POLY_API_KEY}" \
  -H "POLY_PASSPHRASE: ${L2_POLY_PASSPHRASE}" \
  -H "Accept: application/json" \
  -G \
  --data-urlencode "asset_type=${ASSET_TYPE}" \
  --data-urlencode "signature_type=${SIGNATURE_TYPE}" \
  --data-urlencode "funder=${FUNDER_ADDRESS}"

update_status="$HTTP_STATUS"
update_body="$HTTP_BODY"

make_l2_headers "/balance-allowance"
request_json GET "${HOST}/balance-allowance" \
  -H "POLY_ADDRESS: ${L2_POLY_ADDRESS}" \
  -H "POLY_SIGNATURE: ${L2_POLY_SIGNATURE}" \
  -H "POLY_TIMESTAMP: ${L2_POLY_TIMESTAMP}" \
  -H "POLY_API_KEY: ${L2_POLY_API_KEY}" \
  -H "POLY_PASSPHRASE: ${L2_POLY_PASSPHRASE}" \
  -H "Accept: application/json" \
  -G \
  --data-urlencode "asset_type=${ASSET_TYPE}" \
  --data-urlencode "signature_type=${SIGNATURE_TYPE}" \
  --data-urlencode "funder=${FUNDER_ADDRESS}"

balance_status="$HTTP_STATUS"
balance_body="$HTTP_BODY"

echo "updateBalanceAllowance status: ${update_status}"
pretty_print_json_or_raw "$update_body"

echo
echo "getBalanceAllowance status: ${balance_status}"
pretty_print_json_or_raw "$balance_body"

if [[ "$balance_status" -ge 400 ]]; then
  exit 1
fi
