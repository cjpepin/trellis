# Security Policy

## Reporting a vulnerability

If you discover a security issue in this repository or a deployed Trellis instance, please report it responsibly.

**Email:** [support@connorjpepin.com](mailto:support@connorjpepin.com)  
**Subject:** `[Security] Trellis`

Please include:

- A description of the issue and its potential impact
- Steps to reproduce
- Any proof-of-concept code or screenshots (if applicable)

We aim to acknowledge reports within **48 hours** and will work with you on a reasonable disclosure timeline.

Please do **not** open public GitHub issues for undisclosed security vulnerabilities.

## Scope

In scope:

- This repository and its hosted web deployment
- Supabase-backed auth, billing, and Edge Functions
- Electron desktop builds distributed from official download URLs

Out of scope:

- Third-party services (Supabase, Stripe, OpenAI, Anthropic) except where misconfiguration in this project enables abuse
- Portfolio site shell code outside this repository

## Security model

- Client-side code uses the Supabase **publishable (anon) key** only; row-level security enforces access control.
- Server-side secrets (`SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_*`, LLM API keys, cron secrets) live in Supabase Edge Function secrets or host environment variables — never in git.
- Edge Functions use shared auth helpers even when `verify_jwt = false` in `config.toml` (manual JWT validation).
- Demo mode (`VITE_DEMO_MODE=true`) uses local IndexedDB only; cloud paths are disabled.

## Pre-public / post-incident credential rotation

If this repository was ever private, or if you suspect a leak, rotate **all** credentials before publishing or continuing operation.

| Secret | Action |
|--------|--------|
| Supabase JWT secret | Dashboard → Settings → API → rotate JWT secret (invalidates all keys) |
| Supabase publishable key | Regenerate after JWT rotation |
| Supabase service role key | Regenerate; update Edge Function secrets and CI/host env |
| Database password | Regenerate if ever copied into chat, logs, or git |
| Stripe secret key + webhook secret | Rotate in Stripe dashboard; update Supabase secrets |
| OpenAI / Anthropic keys | Rotate if used by Edge Functions or Electron main |
| Cron secrets | Regenerate `ACCOUNT_EXPIRE_CRON_SECRET` / `CRON_SECRET` |

After rotation, update local `.env`, Vercel/Cloudflare env vars, and Supabase Edge Function secrets.

## Safe to publish in client code

- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` when RLS is verified
- `VITE_STRIPE_CHECKOUT_URL` (Stripe Checkout session URL, not secret key)
- Public site URLs and support email

## Never publish

- `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
- Apple signing assets (`.p8`, `.p12`, `.mobileprovision`, `credentials.json`)

## Local secret scanning

Before pushing:

```bash
pnpm run security:check
```

CI runs gitleaks on every pull request (see `.github/workflows/ci.yml`).

## Supported versions

Security fixes are applied to the `main` branch. There are no long-term release branches.
