#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

HOST=127.0.0.1 PORT=${PORT:-8787} node server/index.js &
API_PID=$!

npm run dev:web
