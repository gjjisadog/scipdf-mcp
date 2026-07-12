#!/usr/bin/env bash
# One-step install for scipdf-mcp (MCP + skill).
# Usage:
#   git clone <repo> && cd scipdf-mcp && bash install.sh
#   SCIPDF_DOWNLOAD_DIR=~/Papers bash install.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "[scipdf] Node.js is required (v20+). Install from https://nodejs.org"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[scipdf] npm is required"
  exit 1
fi

node scripts/install.mjs
