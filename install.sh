#!/usr/bin/env bash
set -euo pipefail

REPO="tdije/larpkeeper"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to install Larpkeeper." >&2
  exit 1
fi

if command -v larp >/dev/null 2>&1; then
  echo "Updating Larpkeeper at $(command -v larp)..."
else
  echo "Installing Larpkeeper from GitHub..."
fi
npm install -g "github:${REPO}"

echo
echo "Done."
echo "Run: larp audit ."
