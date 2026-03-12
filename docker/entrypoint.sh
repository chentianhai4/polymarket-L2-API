#!/usr/bin/env bash
set -euo pipefail

LOCAL_PROXY_BIND_HOST="${LOCAL_PROXY_BIND_HOST:-127.0.0.1}"
LOCAL_PROXY_BIND_PORT="${LOCAL_PROXY_BIND_PORT:-10077}"
HOST_PROXY_TARGET="${HOST_PROXY_TARGET:-host.docker.internal:10077}"
ENABLE_LOCAL_PROXY_FORWARD="${ENABLE_LOCAL_PROXY_FORWARD:-1}"

if [[ "${ENABLE_LOCAL_PROXY_FORWARD}" == "1" ]]; then
  export POLYMARKET_PROXY_URL="${POLYMARKET_PROXY_URL:-http://${LOCAL_PROXY_BIND_HOST}:${LOCAL_PROXY_BIND_PORT}}"
  export HTTP_PROXY="${HTTP_PROXY:-${POLYMARKET_PROXY_URL}}"
  export HTTPS_PROXY="${HTTPS_PROXY:-${POLYMARKET_PROXY_URL}}"
  export http_proxy="${http_proxy:-${HTTP_PROXY}}"
  export https_proxy="${https_proxy:-${HTTPS_PROXY}}"
  export NO_PROXY="${NO_PROXY:-127.0.0.1,localhost}"
  export no_proxy="${no_proxy:-${NO_PROXY}}"

  echo "[entrypoint] proxy bind ${LOCAL_PROXY_BIND_HOST}:${LOCAL_PROXY_BIND_PORT} -> ${HOST_PROXY_TARGET}"
  socat \
    "TCP-LISTEN:${LOCAL_PROXY_BIND_PORT},bind=${LOCAL_PROXY_BIND_HOST},fork,reuseaddr" \
    "TCP:${HOST_PROXY_TARGET}" &
  SOCAT_PID=$!
  trap 'kill ${SOCAT_PID} 2>/dev/null || true' EXIT
fi

exec "$@"
