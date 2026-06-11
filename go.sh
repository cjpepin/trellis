#!/usr/bin/env bash
# Start Trellis dev (Vite + Electron) with extraction diagnostics in the **main** process.
# Sources `.env` when present (VITE_*, Supabase, etc.), then forces extraction debug flags.
#
# Usage: ./go.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Keep local extraction on unless .env set it otherwise
export TRELLIS_FEATURE_LOCAL_EXTRACTION="${TRELLIS_FEATURE_LOCAL_EXTRACTION:-1}"
export TRELLIS_FEATURE_CLOUD_EXTRACTION=1

export TRELLIS_LOG_EXTRACTION_TIMING=1
export TRELLIS_LOG_EXTRACTION=1

exec pnpm run dev