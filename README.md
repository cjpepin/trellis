# Trellis

Local-first AI knowledge desktop app (Electron + React + TypeScript). Chats and structured data persist on disk; notes live in a user-chosen vault; Supabase handles auth, billing metadata, and AI orchestration via Edge Functions. See [`mvp.md`](mvp.md) for the full product spec and [`AGENTS.md`](AGENTS.md) for contributor conventions.

## Requirements

- **Node.js** (LTS recommended) and npm
- **Supabase CLI** on your PATH if you work on migrations, local Supabase, or Edge Functions ([install](https://supabase.com/docs/guides/cli))

## Setup

```bash
git clone <repository-url>
cd mnemo
npm install
cp .env.example .env
```

Fill `.env` with your Supabase project URLs and keys. For Edge Function development, copy `supabase/.env.local.example` to `supabase/.env.local` when present and add secrets there (see [`docs/supabase-dx.md`](docs/supabase-dx.md)).

## Development

```bash
npm run dev
```

Runs Vite with the Electron main/preload bundles; the app window opens for local testing.

## Preview workspace

Trellis now ships with a built-in **Preview workspace**: a fully isolated, editable sandbox with seeded chats, notes, raw sources, and graph state meant to feel like roughly six months of regular use.

- The preview lives in its own workspace root under Electron user data and does not reuse your personal account session or local DB.
- On first launch, Trellis lets you choose between your normal personal workspace and the seeded preview.
- From the preview workspace, you can browse or edit the seeded data and use **Reset preview** to restore the original shipped state.

The packaged preview assets live in [`preview-seed/`](preview-seed). To regenerate them after editing the generator:

```bash
npm run preview:seed:generate
```

To validate the shipped fixture:

```bash
npm run test:preview-seed
```

### Extraction rollout flags

Phase 8 keeps local extraction behind a rollout flag while tuning continues.

- `TRELLIS_FEATURE_LOCAL_EXTRACTION=1`
  Enables the Ollama-backed local extraction UI and runtime path in Electron.
- `TRELLIS_ENABLE_HEURISTIC_EXTRACTION_FALLBACK=0`
  Disables the legacy heuristic fallback in the Supabase extraction path once structured V2 output is stable enough.

If `TRELLIS_FEATURE_LOCAL_EXTRACTION` is unset, this build stays on the cloud extraction path even though the local provider implementation is present in the codebase.

## Typecheck

```bash
npm run check
```

## Production build

```bash
npm run build
```

Produces the renderer bundle and packaged Electron app via `electron-builder`.

## Reset local vault contents and PGlite

**Quit Trellis** and stop `npm run dev` first so nothing holds the database files open.

From the repo root, clear every configured vault’s `wiki/` and `raw/` directories (files only; folders stay) and delete the local **PGlite** database:

```bash
npm run reset
```

To target only one workspace:

```bash
node scripts/reset.mjs --workspace=preview
node scripts/reset.mjs --workspace=personal
```

The script reads vault paths from Trellis `settings.json` under Electron’s user data directory (same layout as the running app: e.g. macOS `~/Library/Application Support/trellis/`). To include paths when settings are missing or you want extra trees, set **`TRELLIS_EXTRA_VAULT_PATHS`** to a colon-separated list (`;`-separated on Windows).

Manual PGlite-only wipe (same effect on the DB as `npm run reset`):

```bash
rm -rf "$HOME/Library/Application Support/trellis/pglite-data"
```

On **Linux**, user data is typically under `~/.config/trellis/pglite-data`. On **Windows**, under `%APPDATA%\trellis\pglite-data`.

The next launch recreates PGlite and applies the in-app schema; vault layouts recreate `wiki/` and `raw/` when needed.

> **Note:** This is separate from **local Supabase Postgres**. To reset that stack (migrations replayed on the Supabase CLI database), use `npm run supabase:db:reset` while local Supabase is running. See [`docs/supabase-dx.md`](docs/supabase-dx.md).

## Supabase workflows

Common commands (`supabase:doctor`, `supabase:start`, migrations, types, functions) are documented in [`docs/supabase-dx.md`](docs/supabase-dx.md).

## Wiki and data conventions

Wiki note shape and graph conventions are summarized in [`docs/schema.md`](docs/schema.md).

## Extraction roadmap

The implementation spec for local-first conversation extraction and improved note interlinking lives in [`docs/extraction-v2.md`](docs/extraction-v2.md).

## Extraction evaluation

Phase 8 also adds a repeatable transcript corpus in [`eval/extraction-corpus.json`](eval/extraction-corpus.json) and a comparison runner in [`scripts/extraction-eval.cjs`](scripts/extraction-eval.cjs).

Baseline heuristic run:

```bash
npm run eval:extraction:heuristic
```

V2 run with live provider keys in the environment:

```bash
npm run eval:extraction:v2
```

Compare two saved runs:

```bash
node scripts/extraction-eval.cjs compare --baseline eval/heuristic-results.json --candidate eval/v2-results.json
```
