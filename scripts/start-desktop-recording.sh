#!/usr/bin/env bash
# Launch Trellis desktop (Electron) with settings suited for showcase captures.
#
# Usage:
#   ./scripts/start-desktop-recording.sh                 # preview workspace + demo seed
#   ./scripts/start-desktop-recording.sh --reset-preview # fresh preview seed (quit Trellis first)
#   ./scripts/start-desktop-recording.sh --personal      # personal workspace instead of preview
#   ./scripts/start-desktop-recording.sh --skip-check    # faster restarts between takes
#
# Record via macOS Screenshot (⌘⇧5) or QuickTime → New Screen Recording.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

SKIP_CHECK=false
RESET_PREVIEW=false
ENTER_PREVIEW=true

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --skip-check      Skip pnpm run check (faster relaunch while iterating on takes)
  --reset-preview   Reset the preview workspace seed (quit Trellis first)
  --personal        Open personal workspace instead of the seeded preview
  -h, --help        Show this help

Launches the Electron desktop app via pnpm run dev with DevTools hidden.

By default, opens the preview workspace with shipped demo chats, notes, and graph data.
Use --reset-preview for a fresh seed copy before recording.

Screenshot targets: apps/portfolio/public/trellis/showcase/
  tab-chat.png, tab-notes.png, tab-graph.png
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-check) SKIP_CHECK=true; shift ;;
    --reset-preview) RESET_PREVIEW=true; ENTER_PREVIEW=true; shift ;;
    --enter-preview) ENTER_PREVIEW=true; shift ;;
    --personal) ENTER_PREVIEW=false; shift ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found. Run: corepack enable" >&2
  exit 1
fi

if ! node -e "require('better-sqlite3')" >/dev/null 2>&1; then
  echo "📦 Installing dependencies (native modules + hoisted Electron deps)..."
  pnpm install
  echo ""
fi

echo "🎬 Trellis — desktop recording session"
echo "======================================"
echo ""

if [[ "$SKIP_CHECK" != "true" ]]; then
  echo "🔍 Running type checks..."
  if ! pnpm run check; then
    echo "❌ Fix TypeScript errors or re-run with --skip-check" >&2
    exit 1
  fi
  echo "✅ Type checks passed"
  echo ""
fi

if [[ "$RESET_PREVIEW" == "true" ]]; then
  if pgrep -f "[Ee]lectron.*${ROOT_DIR}" >/dev/null 2>&1 || pgrep -f "vite.*config/vite.config.ts" >/dev/null 2>&1; then
    echo "❌ Quit the running Trellis dev app before --reset-preview." >&2
    exit 1
  fi

  echo "🧹 Resetting preview workspace seed..."
  node "$ROOT_DIR/scripts/reset.mjs" --workspace=preview
  echo ""
fi

if [[ "$ENTER_PREVIEW" == "true" ]]; then
  echo "📂 Opening preview workspace (demo seed)..."
  node --input-type=module <<'NODE'
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const appName = JSON.parse(fs.readFileSync("package.json", "utf8")).name ?? "trellis";
const home = os.homedir();

function userDataDir() {
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", appName);
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, appName);
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(xdg, appName);
}

const statePath = path.join(userDataDir(), "workspace-state.json");
fs.mkdirSync(path.dirname(statePath), { recursive: true });
fs.writeFileSync(
  statePath,
  JSON.stringify({ activeWorkspaceId: "preview", hasCompletedSelection: true }, null, 2),
  "utf8",
);
console.log(`Wrote ${statePath}`);
NODE
  echo ""
fi

cat <<'GUIDE'
📋 Capture checklist (story tab screenshots)
--------------------------------------------
1. Chat — tab-chat.png
   Sidebar → Chat. Select the "Notes from chats" session; keep thread + sidebar visible.

2. Notes — tab-notes.png
   Sidebar → Notes → open "Meeting Distillation" (playbooks folder).
   Show markdown body with YAML frontmatter in the editor.

3. Graph — tab-graph.png
   Sidebar → Graph. Zoom so several linked nodes are visible without crowding.

Tips:
  • Default window is 1440×960 — resize if you want to match the portfolio embed (960×720)
  • Enable Do Not Disturb on macOS to hide notification banners
  • Dismiss the local note processor dialog if it appears (Not now / Remind later)
  • In-app: Settings → Reset preview workspace restores the shipped seed between takes
  • Save PNGs into apps/portfolio/public/trellis/showcase/

GUIDE

echo "🚀 Starting Trellis desktop app (Ctrl+C to stop)..."
echo ""

export TRELLIS_OPEN_DEVTOOLS=0

exec pnpm run dev
