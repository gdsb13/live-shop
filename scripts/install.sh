#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.nvmrc" ]] && [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  . "$HOME/.nvm/nvm.sh"
  nvm use >/dev/null 2>&1 || nvm install
fi

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "install.sh: Node.js was not found. Install Node 20.19 or newer (see .nvmrc), then retry." >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "install.sh: Node $(node -v) is too old. Need 20.19 or newer for Next.js. Use: nvm install && nvm use" >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    corepack enable
    corepack prepare pnpm@9.15.9 --activate
  else
    echo "install.sh: pnpm was not found and corepack is unavailable." >&2
    exit 1
  fi
fi

echo "install.sh: Node $(node -v), pnpm $(pnpm -v)"
for script in "$ROOT"/scripts/*.sh; do
  sed -i 's/\r$//' "$script"
  chmod +x "$script"
done
pnpm install
echo "install.sh: done."
