# Public launch checklist

Steps to squash git history and publish the repository. Run only after [DEPLOY.md](DEPLOY.md) is complete and production is verified.

## Pre-flight

- [ ] `pnpm test && pnpm run build:web:hosted` pass locally
- [ ] Secrets rotated per [SECRET_AUDIT.md](SECRET_AUDIT.md)
- [ ] Production smoke tests pass per [DEPLOY.md](DEPLOY.md)
- [ ] No `.env`, `.pnpm-store/`, or credentials in the working tree
- [ ] `pnpm audit` reports no high-severity vulnerabilities (or documented exceptions)

## Squash history (orphan branch)

```sh
git checkout --orphan public-release
git add -A
git commit -m "Initial public release: Trellis AI knowledge app"
git branch -M main
```

This replaces all prior commits with a single clean commit.

## Push

**Warning:** This rewrites remote history.

```sh
git push --force origin main
```

GitHub may retain orphaned commits for ~90 days. Open a GitHub support ticket to request cache purge if secrets were ever in history.

## GitHub repository settings

After push, in **Settings → General**:

- [ ] Change visibility to **Public**
- [ ] Add description: "Local-first AI knowledge app — Electron, React, Supabase"
- [ ] Add topics: `electron`, `react`, `supabase`, `typescript`, `portfolio`

In **Settings → Code security and analysis**:

- [ ] Enable **Secret scanning**
- [ ] Enable **Push protection**

In **Settings → Branches**:

- [ ] Protect `main` — require CI status check before merge

## Post-public verification

- [ ] GitHub shows exactly **1 commit** on `main`
- [ ] No `.env` or `.pnpm-store/` in the repo tree
- [ ] CI workflow passes on `main`
- [ ] Production site still works after key rotation
- [ ] Client bundle contains only publishable key (DevTools → search for `service_role` — should not appear)
