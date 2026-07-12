#!/usr/bin/env bash
# One-step install / update for scipdf-mcp (MCP + skill + CLI).
#
# Usage:
#   git clone https://github.com/gjjisadog/scipdf-mcp.git
#   cd scipdf-mcp && bash install.sh
#   bash install.sh --update
#   SCIPDF_DOWNLOAD_DIR=~/Papers bash install.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

UPDATE=0
SELFTEST=1
for arg in "$@"; do
  case "$arg" in
    --update|-u) UPDATE=1 ;;
    --no-selftest) SELFTEST=0 ;;
    --help|-h)
      echo "Usage: bash install.sh [--update] [--no-selftest]"
      exit 0
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "[scipdf] Node.js is required (v20+). Install from https://nodejs.org"
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "[scipdf] npm is required"
  exit 1
fi

if [[ "$UPDATE" -eq 1 ]]; then
  if [[ -d .git ]] && command -v git >/dev/null 2>&1; then
    echo "[scipdf] git pull…"
    git pull --ff-only || echo "[scipdf] warn: git pull failed, continuing with local tree"
  else
    echo "[scipdf] warn: not a git checkout; rebuild local tree only"
  fi
fi

export SCIPDF_SELFTEST="${SELFTEST}"
node scripts/install.mjs
