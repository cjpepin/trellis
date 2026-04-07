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
