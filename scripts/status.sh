#!/usr/bin/env bash
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DIR="$ROOT/run"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

API_PORT="${API_PORT:-3001}"
WEB_PORT="${WEB_PORT:-3000}"

status_one() {
  local name="$1"
  local pidfile="$2"
  local url="$3"
  if [[ -f "$pidfile" ]]; then
    local pid
    pid="$(cat "$pidfile" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      echo "$name  RUNNING  pid=$pid  $url"
      return
    fi
  fi
  echo "$name  STOPPED"
}

status_one "backend " "$RUN_DIR/api.pid" "http://localhost:${API_PORT}/health"
status_one "frontend" "$RUN_DIR/web.pid" "http://localhost:${WEB_PORT}"
