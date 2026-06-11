# Electron E2E Testing

Trellis uses Playwright's Electron support for durable smoke and regression coverage.

The automated test surface is split between `tests/node/` for logic and contract coverage and `tests/e2e/` for Electron UI flows.

## When to use each layer

- `npm run test:node`
  - Data contracts, extraction logic, preview seed integrity, filesystem-safe helpers
- `npm run test:e2e`
  - Workspace selection, route navigation, settings flows, other user-critical Electron behavior
- QA/manual validation
  - Acceptance, nuanced UX review, degraded states, and release confidence

## Canonical commands

```bash
npm run test
npm run test:e2e
npm run verify
```

## Deterministic app state

The Playwright harness launches Trellis with a test-only override:

- `TRELLIS_E2E_USER_DATA_DIR`

That points Electron at an isolated `userData` directory so each test run starts cleanly without touching a real local workspace.

## Test design rules

- Prefer seeded preview workspace flows for stable smoke and regression checks.
- Add only the minimal `data-testid` hooks needed for durable selectors.
- Keep E2E focused on user-visible outcomes, not implementation details.
- If a UI change is user-critical or regression-prone, extend the E2E suite as part of the change.
