# Contributing

Thanks for your interest in Trellis. This is primarily a **portfolio and reference showcase** for a local-first AI knowledge app — not an actively maintained open-source product.

## What we welcome

- Bug reports with clear reproduction steps
- Documentation improvements
- Small, focused fixes with tests where applicable

## What we generally won't merge

- Large refactors or rewrites without prior discussion
- Changes to production secrets, env files, or deployment credentials
- Features that expand scope beyond the existing MVP

## Development setup

See [README.md](README.md). In short:

```sh
corepack enable
pnpm install
cp .env.example .env
pnpm run dev
```

Run tests before opening a PR:

```sh
pnpm test
pnpm run build:web:hosted
pnpm run security:check
```

## Pull requests

1. Fork the repository and create a feature branch from `main`.
2. Keep changes focused and explain the motivation in the PR description.
3. Ensure CI passes (check, test, build, secret scan).
4. Do not include secrets, `.env` files, `.pnpm-store/`, or generated artifacts (`out/`, `dist/`).

## Code of conduct

Be respectful and constructive. We reserve the right to close issues or PRs that are spam, abusive, or unrelated to this project.
