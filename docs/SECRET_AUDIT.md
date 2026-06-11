# Secret audit (pre-public launch)

Run this checklist before making the repository public.

## Git history scan results

Manual scans performed on the repository:

```bash
git log --all --full-history -- .env .env.local .dev.vars
# Result: no commits touching env files

git log -S "eyJhbGci" --all --oneline -- . ':!.pnpm-store' ':!supabase/functions/_shared/cloud.test.ts'
# Result: no live JWT literals in history

git log -S "sk-proj" --all --oneline
# Result: no OpenAI project keys in history

git log -S "whsec_" --all --oneline
# Result: only placeholder in .env.example (whsec_your-webhook-secret)
```

**Finding:** No live API keys or `.env` files were found in git history. Prior commits did include:

- **`supabase/.temp/`** — Supabase CLI metadata (project refs, pooler hostnames). Removed from tracking before public release.
- **`.pnpm-store/`** — accidentally committed during pnpm migration. Removed from tracking before public release.
- **`supabase/config.toml`** — contained a linked project ref; replaced with generic placeholder `trellis` before public release.

Rotation is still recommended as insurance.

## Rotate before going public

Complete these in the respective dashboards:

| Secret | Location | Action |
|--------|----------|--------|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase + Edge Function secrets + Vercel/host env | Generate new key in Supabase → Settings → API |
| `SUPABASE_DB_PASSWORD` | Supabase dashboard | Regenerate if ever stored outside Supabase |
| `STRIPE_SECRET_KEY` | Supabase Edge Function secrets | Rotate in Stripe dashboard |
| `STRIPE_WEBHOOK_SECRET` | Supabase Edge Function secrets | Rotate webhook endpoint secret in Stripe |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Supabase secrets + local `.env` | Rotate if keys were used during private development |
| `ACCOUNT_EXPIRE_CRON_SECRET` | Supabase Edge Function secrets | Regenerate cron secret |

Do **not** rotate `VITE_SUPABASE_PUBLISHABLE_KEY` solely for open-sourcing — it is public by design when RLS is enforced.

## Dashboard verification

- [ ] Supabase RLS enabled on all public tables in the `trellis` schema
- [ ] Service role key never set in client-side `VITE_*` variables
- [ ] Stripe webhook endpoint uses the rotated secret
- [ ] Auth redirect URLs restricted to production and preview domains
- [ ] Anonymous sign-ins configured intentionally (guest web access)

## Automated scanning

After pushing the public repo, enable GitHub **Secret scanning** and **Push protection** under Settings → Code security. CI runs gitleaks on every pull request (see `.github/workflows/ci.yml`).

Run locally before push:

```bash
pnpm run security:check
```
