#!/usr/bin/env bash
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DIR="$ROOT/run"

stop_pidfile() {
  local name="$1"
  local pidfile="$2"
  if [[ ! -f "$pidfile" ]]; then
    echo "stop.sh: $name already stopped"
    return 0
  fi
  local pid
  pid="$(cat "$pidfile" 2>/dev/null || true)"
  if [[ -z "$pid" ]]; then
    rm -f "$pidfile"
    echo "stop.sh: $name had a stale PID file"
    return 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$pidfile"
    echo "stop.sh: $name already stopped (stale PID $pid)"
    return 0
  fi
  kill "$pid" 2>/dev/null || true
  local i
  for i in $(seq 1 20); do
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 0.2
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
  fi
  # Next.js may leave a child; stop children of this process group if still ours
  pkill -P "$pid" 2>/dev/null || true
  rm -f "$pidfile"
  echo "stop.sh: $name stopped"
}

stop_pidfile "backend" "$RUN_DIR/api.pid"
stop_pidfile "frontend" "$RUN_DIR/web.pid"

# Kill orphaned listeners left behind when PID files are stale (common during dev).
API_PORT="${API_PORT:-3001}"
WEB_PORT="${WEB_PORT:-3000}"
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${API_PORT}/tcp" 2>/dev/null || true
  fuser -k "${WEB_PORT}/tcp" 2>/dev/null || true
elif command -v lsof >/dev/null 2>&1; then
  for port in "$API_PORT" "$WEB_PORT"; do
    pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      kill $pids 2>/dev/null || true
    fi
  done
fi
