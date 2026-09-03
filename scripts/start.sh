#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  . "$HOME/.nvm/nvm.sh"
  nvm use >/dev/null 2>&1 || true
fi

API_PORT="${API_PORT:-3001}"
API_HOST="${API_HOST:-0.0.0.0}"
WEB_PORT="${WEB_PORT:-3000}"
WEB_HOST="${WEB_HOST:-0.0.0.0}"
WEB_ORIGIN="${WEB_ORIGIN:-http://localhost:${WEB_PORT}}"
NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:${API_PORT}}"

RUN_DIR="$ROOT/run"
LOG_DIR="$ROOT/logs"
mkdir -p "$RUN_DIR" "$LOG_DIR"

is_running() {
  local pidfile="$1"
  [[ -f "$pidfile" ]] || return 1
  local pid
  pid="$(cat "$pidfile")"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

wait_http() {
  local url="$1"
  local name="$2"
  local i
  for i in $(seq 1 60); do
    if curl -sf --max-time 2 "$url" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  echo "start.sh: $name did not respond at $url" >&2
  echo "start.sh: see logs in $LOG_DIR" >&2
  return 1
}

if is_running "$RUN_DIR/api.pid" || is_running "$RUN_DIR/web.pid"; then
  echo "start.sh: already running. Use ./scripts/status.sh or ./scripts/stop.sh first."
  "$ROOT/scripts/status.sh"
  exit 0
fi

export API_PORT API_HOST WEB_ORIGIN NEXT_PUBLIC_API_URL AGORA_APP_ID AGORA_APP_CERTIFICATE AGORA_SIGNALING_AREA
export AI_PUBLIC_BASE_URL AI_CUSTOM_LLM_API_KEY AGORA_AI_AREA
export API_PROXY_TARGET="http://127.0.0.1:${API_PORT}"

setsid nohup node "$ROOT/apps/api/src/server.js" >>"$LOG_DIR/api.log" 2>&1 </dev/null &
echo $! >"$RUN_DIR/api.pid"

setsid nohup env API_PROXY_TARGET="$API_PROXY_TARGET" pnpm --filter web exec next dev --hostname "$WEB_HOST" --port "$WEB_PORT" >>"$LOG_DIR/web.log" 2>&1 </dev/null &
echo $! >"$RUN_DIR/web.pid"

wait_http "http://127.0.0.1:${API_PORT}/health" "backend"
if ! curl -sf "http://127.0.0.1:${API_PORT}/api/ai/status" | grep -q searchProducts; then
  echo "start.sh: API is up but Voice AI routes are missing or broken." >&2
  echo "start.sh: tail of logs/api.log:" >&2
  tail -30 "$LOG_DIR/api.log" >&2 || true
  exit 1
fi
wait_http "http://127.0.0.1:${WEB_PORT}" "frontend"

echo "start.sh: backend  http://localhost:${API_PORT}/health"
echo "start.sh: frontend http://localhost:${WEB_PORT}"
echo "start.sh: logs     $LOG_DIR"
