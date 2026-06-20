#!/usr/bin/env bash
# Build static Trellis web demo for portfolio embedding at /trellis/demo.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

OUTPUT_DIR="${1:-$ROOT_DIR/dist/web-demo}"
BASE_PATH="${VITE_WEB_BASE_PATH:-/trellis/demo}"

export TRELLIS_VITE_WEB_ONLY=1
export TRELLIS_VITE_HOSTED_WEB=1
export VITE_DEMO_MODE=true
export VITE_WEB_BASE_PATH="$BASE_PATH"

echo "Syncing preview seed into web demo..."
node "$ROOT_DIR/scripts/sync-web-demo-seed.mjs"

echo "Building Trellis web demo with base path: $BASE_PATH"
pnpm exec vite build --config config/vite.config.ts

RENDERER_OUT="$ROOT_DIR/apps/web/out/build/renderer"
OUTPUT_DIR="${1:-$ROOT_DIR/dist/web-demo}"

if [[ ! -f "$RENDERER_OUT/index.html" ]]; then
  echo "Missing renderer build at $RENDERER_OUT" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
rm -rf "$OUTPUT_DIR"/*
cp -R "$RENDERER_OUT"/* "$OUTPUT_DIR/"

cat <<EOF

Trellis web demo build complete: $OUTPUT_DIR

Sync into portfolio:
  cd apps/portfolio && ./scripts/sync-trellis-demo.sh

EOF
