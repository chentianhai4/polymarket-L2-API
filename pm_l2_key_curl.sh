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

if [[ -z "${PRIVATE_KEY:-}" ]]; then
  echo "Missing PRIVATE_KEY in .env or environment" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi

eval "$(CHAIN_ID="$CHAIN_ID" node --input-type=module <<'NODE'
import { Wallet } from "ethers";
import { createL1Headers } from "@polymarket/clob-client/dist/headers/index.js";

const signer = new Wallet(process.env.PRIVATE_KEY);
const chainId = Number(process.env.CHAIN_ID || "137");
const headers = await createL1Headers(signer, chainId);
const signerAddress = await signer.getAddress();

console.log(`SIGNER=${JSON.stringify(signerAddress)}`);
for (const [k, v] of Object.entries(headers)) {
  console.log(`${k}=${JSON.stringify(v)}`);
}
NODE
)"

echo "Signer: $SIGNER"

request_json() {
  local method="$1"
  local url="$2"
  shift 2
  local raw
  raw="$(curl -sS -X "$method" "$url" "$@" -w $'\n%{http_code}')"
  HTTP_STATUS="${raw##*$'\n'}"
  HTTP_BODY="${raw%$'\n'*}"
}

normalize_creds() {
  node --input-type=module -e '
const raw = process.argv[1] ?? "";
let parsed = {};
try {
  parsed = raw ? JSON.parse(raw) : {};
} catch {
  parsed = {};
}
const out = {
  key: parsed.key ?? parsed.apiKey ?? "",
  secret: parsed.secret ?? "",
  passphrase: parsed.passphrase ?? "",
};
process.stdout.write(JSON.stringify(out));
' "$1"
}

has_key() {
  node --input-type=module -e '
const raw = process.argv[1] ?? "";
let parsed = {};
try {
  parsed = raw ? JSON.parse(raw) : {};
} catch {
  parsed = {};
}
console.log(Boolean(parsed.key));
' "$1"
}

request_json POST "${HOST}/auth/api-key" \
  -H "POLY_ADDRESS: ${POLY_ADDRESS}" \
  -H "POLY_SIGNATURE: ${POLY_SIGNATURE}" \
  -H "POLY_TIMESTAMP: ${POLY_TIMESTAMP}" \
  -H "POLY_NONCE: ${POLY_NONCE}" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json"

create_status="$HTTP_STATUS"
create_body="$HTTP_BODY"
creds_json="$(normalize_creds "$create_body")"

if [[ "$(has_key "$creds_json")" != "true" ]]; then
  request_json GET "${HOST}/auth/derive-api-key" \
    -H "POLY_ADDRESS: ${POLY_ADDRESS}" \
    -H "POLY_SIGNATURE: ${POLY_SIGNATURE}" \
    -H "POLY_TIMESTAMP: ${POLY_TIMESTAMP}" \
    -H "POLY_NONCE: ${POLY_NONCE}" \
    -H "Accept: application/json"

  derive_status="$HTTP_STATUS"
  derive_body="$HTTP_BODY"
  creds_json="$(normalize_creds "$derive_body")"

  if [[ "$(has_key "$creds_json")" != "true" ]]; then
    echo "Failed to create or derive L2 API key" >&2
    echo "Create status: $create_status" >&2
    echo "Create body: $create_body" >&2
    echo "Derive status: $derive_status" >&2
    echo "Derive body: $derive_body" >&2
    exit 1
  fi
fi

echo
echo "L2 API creds:"
node --input-type=module -e '
const parsed = JSON.parse(process.argv[1] ?? "{}");
console.log(JSON.stringify(parsed, null, 2));
' "$creds_json"
