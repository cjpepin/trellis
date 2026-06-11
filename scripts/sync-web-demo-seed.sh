#!/usr/bin/env bash
# Copy preview-seed fixture into the Trellis web demo (chat + static vault).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
node "$ROOT_DIR/scripts/sync-web-demo-seed.mjs"
