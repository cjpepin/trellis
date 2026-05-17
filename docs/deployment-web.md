# Hosted Web Deployment

## Build

This repo uses **pnpm** workspaces (`apps/web`, `apps/desktop`, …). From the **repository root**:

- Capacitor / app-local web bundle: `pnpm run build:web`
- Hosted production web bundle: `pnpm run build:web:hosted`

The hosted build sets `TRELLIS_VITE_WEB_ONLY=1` and `TRELLIS_VITE_HOSTED_WEB=1` so Vite emits **only** the browser bundle (no Electron main/preload) and uses absolute asset paths so deep links like `/updates/my-post` and `/app/chat` refresh correctly on static hosts.

## Vercel

Configure the project against the **monorepo root** (not `apps/web` alone). The repo includes [`vercel.json`](../vercel.json) so Vercel picks up install/build/output and SPA routing.

**Important:** Install must be **workspace-filtered** (`--filter @trellis/web...`). A plain root `pnpm install` still installs `@trellis/desktop` and runs `electron-builder install-app-deps`, which is appropriate for local/desktop CI but typically **fails on Vercel**.

| Setting | Value |
|--------|--------|
| **Root Directory** | `.` (repository root) |
| **Install Command** | `corepack enable && pnpm install --frozen-lockfile --filter @trellis/web...` (matches `vercel.json`; Node 20+) |
| **Build Command** | `pnpm run build:web:hosted` |
| **Output Directory** | `out/build/renderer` |

Hosted web uses **history** routing under `/app/*` ([`PublicSiteRouter`](../apps/web/src/routes/public/PublicSiteRouter.tsx)). **`apps/web/public/_redirects`** applies to Netlify-style hosts; **Vercel ignores it**, so the SPA fallback lives in **`vercel.json`** (`rewrites` → `/index.html`). Static assets under `out/build/renderer` are still served as files first.

Set the same **`VITE_*`** variables as in [Required env](#required-env) in the Vercel project for **Production** and **Preview** (Vite inlines them at build time).

If you must point Vercel’s UI at `apps/web`, override install/build so **`pnpm install` still runs from the repo root** with `--filter @trellis/web...` (and build still invokes the root `vite` config under `config/`). Subdirectory-only installs without the workspace graph will fail.

## Required env

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SITE_URL`
- `VITE_SUPPORT_EMAIL`
- `VITE_DOWNLOAD_MAC_URL`
- `VITE_DOWNLOAD_MAC_VERSION`

## Supabase setup

- Set the Auth Site URL to your production web origin.
- Add redirect URLs for:
  - `http://127.0.0.1:5173/auth/confirm`
  - `http://localhost:5173/auth/confirm`
  - `https://yourdomain.com/auth/confirm`
  - your preview deployment URLs if they support auth testing
- Keep anonymous sign-ins enabled if you want guest web access.
- Run the new SQL migration before deploying the new public site.
- Deploy the new Edge Functions:
  - `feature-forum-submit`
  - `account-upgrade-complete`

## Static hosting checklist

- Upload the hosted renderer build output from `out/build/renderer`.
- Keep `public/_redirects` in the deployed artifact so `/app/*` and public deep links resolve to the SPA.
- Point your production domain at the host and verify HTTPS before adding it to Supabase Auth.
- Swap the placeholder Mac download URL for the real signed artifact when it is ready.

## Recommended first-pass launch flow

1. Deploy SQL and Edge Functions to Supabase.
2. Build with `pnpm run build:web:hosted`.
3. Deploy the renderer bundle to Cloudflare Pages or your chosen static host.
4. Update Supabase Auth redirect URLs and Site URL.
5. Verify:
   - `/`
   - `/auth`
   - `/updates`
   - `/forum`
   - `/app/chat`
   - guest quota modal
   - admin moderation and update publishing
