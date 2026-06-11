# Trellis

Local-first AI knowledge desktop app: **Electron + React + TypeScript**. Chats and structured data live on disk; notes live in a user-chosen vault; **Supabase** covers auth, billing metadata, and AI via Edge Functions.

| Doc | Purpose |
| --- | --- |
| [Product spec](docs/mvp.md) | UX, architecture intent, MVP scope |
| [AGENTS.md](AGENTS.md) | Repo contract: boundaries, verification, data conventions |
| [Supabase DX](docs/supabase-dx.md) | CLI, env, migrations, functions, local stack |
| [Deployment](docs/deployment-web.md) | Hosted web build and Vercel settings |
| [Production checklist](docs/DEPLOY.md) | Pre-launch deploy steps |
| [Public launch](docs/PUBLIC_LAUNCH.md) | Squash history and go-public checklist |
| [Schema & notes](docs/schema.md) | Vault markdown, frontmatter, graph links |
| [Agent workflow](docs/agents/README.md) | How feature work is planned, built, tested, QA'd |
| [Electron E2E](docs/testing/electron-e2e.md) | Playwright setup and expectations |
| [Extraction V2](docs/extraction-v2.md) | Local-first extraction and note interlinking roadmap |
| [Extraction routing](docs/extraction-routing.md) | Cloud vs on-device extraction, env flags, profiling |

## Requirements

- **Node.js** 20+ and **pnpm** 9 (`corepack enable`)
- **Supabase CLI** on your PATH if you touch migrations, local Supabase, or Edge Functions — [install](https://supabase.com/docs/guides/cli)

## Setup

```bash
git clone https://github.com/cjpepin/trellis.git
cd trellis
corepack enable
pnpm install
cp .env.example .env
```

Configure Supabase URLs, keys, and Edge secrets in `.env` (details in [Supabase DX](docs/supabase-dx.md)). Optional overrides: `.env.local` at the repo root.

## Development

```bash
pnpm run dev          # Vite + Electron; app window opens
pnpm run dev:web      # Web-only dev server
pnpm run check        # TypeScript (run before PRs)
pnpm run build        # Renderer + packaged app (electron-builder)
pnpm run build:web:hosted  # Hosted SPA for static deployment
```

**Tests:** `pnpm test` (TypeScript + node tests) · `pnpm run test:e2e` · `pnpm run verify` (check + node + e2e) · optional `pnpm run test:supabase` when Deno is installed — see AGENTS.md for when to use which. If node tests fail to load `better-sqlite3` (native ABI mismatch), run `node scripts/rebuild-native-if-needed.mjs`.

**Security:** `pnpm run security:check` before pushing. See [SECURITY.md](SECURITY.md).

## Repository layout

| Path | Role |
| --- | --- |
| `apps/web/src/` | Renderer: routes, components, hooks, client state |
| `apps/desktop/electron/` | Main process, IPC, filesystem, SQLite (`better-sqlite3`) |
| `packages/shared/` · `packages/contracts/` | Cross-runtime types and IPC contracts |
| `packages/demo-local/` | IndexedDB helpers for portfolio demo embed |
| `supabase/` | Migrations, Edge Functions, shared function code |
| `scripts/` | Automation (reset, Supabase helpers, eval, preview seed) |
| `tests/node/` · `tests/e2e/` | Node tests · Playwright Electron |
| `fixtures/` | Preview seed (`fixtures/preview-seed/`), extraction eval corpus (`fixtures/eval/`) |

Build and test artifacts: `out/` (`out/build/`, `out/release/`, `out/test-results/`).

## Preview workspace

Isolated, editable sandbox with seeded chats, notes, and graph data (does not use your personal DB). Use **Reset preview** in-app to restore the shipped seed.

**Use the preview as a user** (after [Setup](#setup)):

```bash
pnpm run dev
```

On first launch, pick **Explore preview workspace** (not "Start personal workspace"). Trellis copies the seed from the bundled fixture into your app user data and opens the preview vault.

**Change the shipped seed** (contributors):

```bash
pnpm run preview:seed:generate   # rebuild fixtures/preview-seed/ from the generator
pnpm run test:preview-seed       # assert the fixture matches expectations
```

Source: [`fixtures/preview-seed/`](fixtures/preview-seed/).

## Portfolio demo embed

Build a static demo for embedding at `/trellis/demo` on connorjpepin.com:

```bash
bash scripts/export-web-demo.sh
```

Output: `dist/web-demo/`. Uses local IndexedDB only (`VITE_DEMO_MODE=true`); no Supabase credentials required.

## Local extraction (env)

Defaults and full detail are in **AGENTS.md** and `.env.example`. In short: local extraction is **on** by default; set `TRELLIS_FEATURE_LOCAL_EXTRACTION=0` to disable on-device note processing (no cloud fallback). Heuristic fallback in Supabase extraction is controlled with `TRELLIS_ENABLE_HEURISTIC_EXTRACTION_FALLBACK`.

Optional **cloud extraction** for chat sessions that already use a cloud provider: set `TRELLIS_FEATURE_CLOUD_EXTRACTION=1` and configure API keys in Settings (see [Extraction routing](docs/extraction-routing.md)). On-device extraction remains for local-only chat, offline use, and when cloud extraction fails.

## Reset local vault + SQLite

Quit Trellis and stop `pnpm run dev` first.

```bash
pnpm run reset                              # all configured vault wiki/raw + workspace SQLite
node scripts/reset.mjs --workspace=preview
node scripts/reset.mjs --workspace=personal
# Full reset but keep preview + preview-heavy workspaces (personal only):
node scripts/reset.mjs --workspace=all --exclude-preview
# or: TRELLIS_RESET_EXCLUDE_PREVIEW=1 pnpm run reset
# Vault wiki/raw uses workspaces/personal/settings.json only (falls back to legacy root settings if needed).
```

Optional extra vault trees: `TRELLIS_EXTRA_VAULT_PATHS` (colon-separated; `;` on Windows). Paths come from Trellis `settings.json` under app user data (e.g. macOS `~/Library/Application Support/trellis/`).

Manual DB wipe (same effect as reset): delete `workspaces/<id>/local.sqlite` (and `-wal`/`-shm` if present) under app data, and remove any legacy `pglite-data` folders from older builds.

**Supabase local Postgres** (CLI stack) is separate: `pnpm run supabase:db:reset` while local Supabase is running — [Supabase DX](docs/supabase-dx.md).

## Extraction evaluation

Corpus: [`fixtures/eval/extraction-corpus.json`](fixtures/eval/extraction-corpus.json). Runner: [`scripts/extraction-eval.cjs`](scripts/extraction-eval.cjs).

```bash
pnpm run eval:extraction:heuristic
pnpm run eval:extraction:v2
pnpm run eval:extraction:ollama    # optional HTTP chat API (see AGENTS.md)
node scripts/extraction-eval.cjs compare --baseline fixtures/eval/heuristic-results.json --candidate fixtures/eval/v2-results.json
```

## License

[MIT](LICENSE)
