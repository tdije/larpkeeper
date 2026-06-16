#!/usr/bin/env bash
set -euo pipefail

REPO="tdije/larpkeeper"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to install Larpkeeper." >&2
  exit 1
fi

if command -v larp >/dev/null 2>&1; then
  echo "Larpkeeper is already installed: $(command -v larp)"
  exit 0
fi

echo "Installing Larpkeeper from GitHub..."
npm install -g "github:${REPO}"

echo
echo "Done."
echo "Run: larp audit ."
