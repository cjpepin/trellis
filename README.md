# Trellis

Local-first AI knowledge desktop app: **Electron + React + TypeScript**. Chats and structured data live on disk; notes live in a user-chosen vault; **Supabase** covers auth, billing metadata, and AI via Edge Functions.

| Doc | Purpose |
| --- | --- |
| [Product spec](docs/mvp.md) | UX, architecture intent, MVP scope |
| [AGENTS.md](AGENTS.md) | Repo contract: boundaries, verification, data conventions |
| [Supabase DX](docs/supabase-dx.md) | CLI, env, migrations, functions, local stack |
| [Schema & notes](docs/schema.md) | Vault markdown, frontmatter, graph links |
| [Agent workflow](docs/agents/README.md) | How feature work is planned, built, tested, QA’d |
| [Electron E2E](docs/testing/electron-e2e.md) | Playwright setup and expectations |
| [Extraction V2](docs/extraction-v2.md) | Local-first extraction and note interlinking roadmap |

## Requirements

- **Node.js** (LTS) and npm  
- **Supabase CLI** on your PATH if you touch migrations, local Supabase, or Edge Functions — [install](https://supabase.com/docs/guides/cli)

## Setup

```bash
git clone <repository-url>
cd trellis
npm install
cp .env.example .env
```

Configure Supabase URLs, keys, and Edge secrets in `.env` (details in [Supabase DX](docs/supabase-dx.md)). Optional overrides: `.env.local` at the repo root.

## Development

```bash
npm run dev          # Vite + Electron; app window opens
npm run check        # TypeScript (run before PRs)
npm run build        # Renderer + packaged app (electron-builder)
```

**Tests:** `npm run test:node` · `npm run test:e2e` · `npm run verify` (check + node + e2e) — see AGENTS.md for when to use which.

## Repository layout

| Path | Role |
| --- | --- |
| `src/` | Renderer: routes, components, hooks, client state |
| `electron/` | Main process, IPC, filesystem, SQLite/PGlite |
| `shared/` | Cross-runtime types and helpers |
| `supabase/` | Migrations, Edge Functions, shared function code |
| `scripts/` | Automation (reset, Supabase helpers, eval, preview seed) |
| `tests/node/` · `tests/e2e/` | Node tests · Playwright Electron |
| `fixtures/` | Preview seed (`fixtures/preview-seed/`), extraction eval corpus (`fixtures/eval/`) |

Build and test artifacts: `out/` (`out/build/`, `out/release/`, `out/test-results/`).

## Preview workspace

Isolated, editable sandbox with seeded chats, notes, and graph data (does not use your personal DB). Use **Reset preview** in-app to restore the shipped seed.

**Use the preview as a user** (after [Setup](#setup)):

```bash
npm run dev
```

On first launch, pick **Explore preview workspace** (not “Start personal workspace”). Trellis copies the seed from the bundled fixture into your app user data and opens the preview vault.

**Change the shipped seed** (contributors):

```bash
npm run preview:seed:generate   # rebuild fixtures/preview-seed/ from the generator
npm run test:preview-seed       # assert the fixture matches expectations
```

Source: [`fixtures/preview-seed/`](fixtures/preview-seed/).

## Local extraction (env)

Defaults and full detail are in **AGENTS.md** and `.env.example`. In short: local extraction is **on** by default; set `TRELLIS_FEATURE_LOCAL_EXTRACTION=0` to force cloud-only. Heuristic fallback in Supabase extraction is controlled with `TRELLIS_ENABLE_HEURISTIC_EXTRACTION_FALLBACK`.

## Reset local vault + PGlite

Quit Trellis and stop `npm run dev` first.

```bash
npm run reset                              # all configured vault wiki/raw + PGlite
node scripts/reset.mjs --workspace=preview
node scripts/reset.mjs --workspace=personal
```

Optional extra vault trees: `TRELLIS_EXTRA_VAULT_PATHS` (colon-separated; `;` on Windows). Paths come from Trellis `settings.json` under app user data (e.g. macOS `~/Library/Application Support/trellis/`).

PGlite-only wipe (same DB effect as `npm run reset`): remove `pglite-data` under that app data folder (`~/.config/trellis/` on Linux, `%APPDATA%\trellis\` on Windows).

**Supabase local Postgres** (CLI stack) is separate: `npm run supabase:db:reset` while local Supabase is running — [Supabase DX](docs/supabase-dx.md).

## Extraction evaluation

Corpus: [`fixtures/eval/extraction-corpus.json`](fixtures/eval/extraction-corpus.json). Runner: [`scripts/extraction-eval.cjs`](scripts/extraction-eval.cjs).

```bash
npm run eval:extraction:heuristic
npm run eval:extraction:v2
npm run eval:extraction:ollama    # optional HTTP chat API (see AGENTS.md)
node scripts/extraction-eval.cjs compare --baseline fixtures/eval/heuristic-results.json --candidate fixtures/eval/v2-results.json
```
