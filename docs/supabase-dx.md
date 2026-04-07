# Supabase DX Helpers

Trellis includes a small wrapper around the Supabase CLI so the common workflows are easier to remember and safer to repeat.

## Quick Commands

| Command | Purpose |
| ------- | ------- |
| `npm run supabase:doctor` | Print a diagnostic summary of CLI source, env vars, functions, and migrations. |
| `npm run supabase:login` | Authenticate the Supabase CLI, using `SUPABASE_ACCESS_TOKEN` when set. |
| `npm run supabase:link -- your-project-ref` | Link the repo to a remote Supabase project (falls back to `SUPABASE_PROJECT_REF`). |
| `npm run supabase:start` | Start local Supabase containers (Postgres, Auth, Storage, etc.). |
| `npm run supabase:stop` | Stop and remove local Supabase containers. |
| `npm run supabase:status` | Show the running state and endpoints of local Supabase services. |
| `npm run supabase:db:push` | Push local migrations to the linked remote database. |
| `npm run supabase:db:reset` | Drop and recreate the local database, replaying all migrations. |
| `npm run supabase:db:diff -- <name>` | Diff the local database against migrations and write a new migration file. |
| `npm run supabase:migration:new -- <name>` | Scaffold an empty migration SQL file with a timestamped name. |
| `npm run supabase:types:gen` | Generate TypeScript types from the database schema into `src/lib/database.types.ts`. |
| `npm run supabase:functions:serve` | Serve all Edge Functions locally with hot reload (accepts optional function name). |
| `npm run supabase:functions:deploy` | Deploy all Edge Functions to the linked project (accepts optional function names). |
| `npm run supabase:backend:deploy` | Run `db:push` then `functions:deploy` in sequence for a full backend ship. |

## Behavior

- The helper loads env values from `.env`, `.env.local`, `supabase/.env`, and `supabase/.env.local`.
- `supabase:login` uses `SUPABASE_ACCESS_TOKEN` automatically when it is set.
- `supabase:functions:deploy` deploys every function in `supabase/functions/` by default, excluding `_shared/`.
- `supabase:functions:serve` automatically adds `--env-file supabase/.env.local` when that file exists.
- `supabase:db:push` forwards `SUPABASE_DB_PASSWORD` when it is set.
- `supabase:db:diff` creates a migration file and defaults to the `public,auth` schemas unless you pass your own schema flags.
- `supabase:link` uses `SUPABASE_PROJECT_REF` if you do not pass a ref explicitly.
- `supabase:types:gen` writes TypeScript database types to `src/lib/database.types.ts` by default, using the linked project when `SUPABASE_PROJECT_REF` is set and falling back to `--local` otherwise.
- `supabase:backend:deploy` runs database migrations first and then deploys Edge Functions, which is useful when a backend change spans SQL plus functions.

## Recommended Env Vars

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` for the renderer
- `SUPABASE_PROJECT_REF`
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_WEBHOOK_SECRET`

## Notes

- Never expose `SUPABASE_SERVICE_ROLE_KEY` or an `sb_secret_...` key through a `VITE_` variable. The renderer must use a publishable key only.
- Chat requests send conversation text to your Supabase `chat` Edge Function, which may forward it to OpenAI or Anthropic depending on the selected model.
- The chat model comes from the UI selector for each request rather than a server-side chat model env var.
- Extraction requests send transcripts or clipped source text to your Supabase `extract` Edge Function, but the current extraction path does not forward that content to third-party model providers.
- The only cloud metadata written by default is profile and usage state such as counts, session IDs, token counts, and source titles. Message bodies are not written to Postgres tables in this repo.
- These helpers still rely on the Supabase CLI being installed locally or available on your `PATH`.
- For local Edge Function work, copy `supabase/.env.local.example` to `supabase/.env.local` and fill in the values you need.
- A practical workflow is: `supabase:doctor`, `supabase:start`, `supabase:db:diff`, `supabase:types:gen`, and then `supabase:backend:deploy` when you are ready to ship.
