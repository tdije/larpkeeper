#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
METIS_ROOT="${METIS_TASK_MEMORY_ROOT:-}"
PROJECT_NAME="${METIS_TASK_MEMORY_PROJECT:-}"
if [ -z "$METIS_ROOT" ]; then
  METIS_ROOT='/Users/7senju/Desktop/Metis'
fi
if [ -z "$PROJECT_NAME" ]; then
  PROJECT_NAME='Larpkeeper'
fi

if [ -f "$METIS_ROOT/dist/scripts/followup-memory.js" ]; then
  node "$METIS_ROOT/dist/scripts/followup-memory.js" --repo "$REPO_ROOT" --project "$PROJECT_NAME" "$@"
else
  cd "$METIS_ROOT"
  npx tsx src/scripts/followup-memory.ts --repo "$REPO_ROOT" --project "$PROJECT_NAME" "$@"
fi
