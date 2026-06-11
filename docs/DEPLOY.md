# Production deployment checklist

Complete these steps when deploying Trellis hosted web to production.

See also [deployment-web.md](deployment-web.md) for build commands and Vercel settings.

## 1. Rotate secrets

Follow [SECRET_AUDIT.md](SECRET_AUDIT.md):

- [ ] Rotate `SUPABASE_SERVICE_ROLE_KEY` in Supabase and host env
- [ ] Rotate `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`
- [ ] Rotate LLM API keys if used by Edge Functions
- [ ] Regenerate cron secrets (`ACCOUNT_EXPIRE_CRON_SECRET`)

## 2. Apply Supabase migrations

On your Supabase project:

```bash
pnpm run supabase:backend:deploy
```

Verify the `trellis` schema is exposed in **Settings → API → Exposed schemas**.

## 3. Supabase Auth redirect URLs

Add to **Auth → URL configuration** (replace `yourdomain.com`):

- `https://yourdomain.com/auth/confirm`
- `http://127.0.0.1:5173/auth/confirm`
- `http://localhost:5173/auth/confirm`
- Preview deployment URLs if auth testing is needed

Set **Site URL** to your production web origin.

## 4. Deploy hosted web

Build env vars (**Production** and **Preview**):

| Variable | Encrypted |
|----------|-----------|
| `VITE_SUPABASE_URL` | No (build-time) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | No (build-time) |
| `VITE_SITE_URL` | No (build-time) |
| `VITE_SUPPORT_EMAIL` | No (build-time) |
| `VITE_DOWNLOAD_MAC_URL` | No (build-time) |
| `VITE_DOWNLOAD_MAC_VERSION` | No (build-time) |

Build and deploy:

```bash
pnpm run build:web:hosted
# Upload out/build/renderer to your static host (Vercel, Cloudflare Pages, etc.)
```

## 5. Portfolio demo embed (optional)

For the `/trellis/demo` embed on connorjpepin.com:

```bash
bash scripts/export-web-demo.sh
# Sync from portfolio monorepo: apps/portfolio/scripts/sync-trellis-demo.sh
```

Demo build uses `VITE_DEMO_MODE=true` and does not require Supabase credentials.

## 6. Smoke tests

After deploy, verify:

- [ ] `/` — landing page loads
- [ ] `/auth` — sign-in flow
- [ ] `/updates` and `/forum` — public pages
- [ ] `/app/chat` — authenticated chat (deep link refresh works)
- [ ] Guest quota modal for anonymous users
- [ ] Admin moderation and update publishing (if admin user configured)
- [ ] Client bundle has no `service_role` string (DevTools search)

## 7. Electron desktop (optional)

When distributing Mac builds:

- [ ] Code signing and notarization configured in `electron-builder.yml`
- [ ] `VITE_DOWNLOAD_MAC_URL` points to signed artifact
- [ ] Hardened runtime enabled
