# AGENTS.md

This repository follows [`mvp.md`](/Users/connorpepin/Cursor/mnemo/mvp.md) as the product source of truth. The one intentional architectural change is that Supabase replaces the bespoke backend service: use Supabase Auth for identity, Postgres for account and billing state, and Edge Functions for AI chat, extraction, and webhook handling.

## Working Principles

- Preserve the local-first contract. Chats persist in SQLite, notes live in the user’s vault, and the app remains useful when cloud services are unavailable.
- Treat UX as a feature. Empty states, loading states, error recovery, and first-run setup are part of the MVP, not polish.
- Keep TypeScript in strict mode. Do not introduce `any`; use `unknown` and narrow at boundaries.
- Favor small files with one primary export. Split helpers before functions become difficult to scan.
- No inline styles. Tailwind classes plus `src/globals.css` variables only.
- Respect secure boundaries. The renderer never touches Node APIs directly; all privileged work goes through typed IPC.
- Keep note writes inside the configured vault. Enforce prefix checks before every write or copy operation.

## Agent Workflow

- Use the repo-local role skills in `.codex/skills/` and the operator docs in `docs/agents/`.
- Default feature flow is: `product-plan-agent` -> `senior-dev-agent` -> `senior-tester-agent` -> `senior-qa-agent`.
- Use `repo-refactor-agent` only for explicit cleanup, security, or maintenance requests, or as a separate follow-up pass after feature delivery.
- Keep handoffs structured using `docs/agents/handoffs.md` so downstream agents inherit exact acceptance criteria, verification expectations, and known risks.

## Architecture Rules

- Electron owns local capabilities: SQLite, vault reads and writes, secure token storage, PDF parsing, and web clipping.
- React owns presentation, route composition, and optimistic UX.
- Zustand owns app state. Avoid prop drilling past two levels.
- Supabase owns auth sessions, subscription metadata, usage counters, and AI orchestration through Edge Functions.
- Prompts live only in `supabase/functions/_shared/prompts.ts`.
- IPC channel names and payload contracts live only in `electron/ipc/types.ts`.
- Default on-device extraction uses `node-llama-cpp` in the Electron main process against a single GGUF path under app user data (`embeddedExtractionGgufFilename` / `defaultLocalExtractionModelId` in `shared/extraction/config.ts`); weights are not bundled—first run downloads once (override URL with `TRELLIS_EMBEDDED_EXTRACTION_MODEL_URL`). The local extraction feature flag defaults **on**; set `TRELLIS_FEATURE_LOCAL_EXTRACTION=0` to disable on-device note processing entirely (there is no cloud extraction path). Dev eval against a running HTTP chat API: `npm run eval:extraction:ollama` (optional; override with `TRELLIS_EXTRACTION_MODEL`).

## UX Standards

- Match the considered-dark design system from `mvp.md`, including the warm amber accent and restrained motion.
- Cold-start states must feel intentional. Blank panels are a bug unless the user is actively editing.
- Stream chat output token-by-token and prefer subtle pulses or skeletons over spinners.
- Use clear, steady language in UI copy. The product should feel calm and precise, not chatty.
- Respect `prefers-reduced-motion` for route and message entrance animations.

## Verification Expectations

- Every behavior change must run `npm run check`.
- Canonical automated verification commands are:
  - `npm run test:node`
  - `npm run test:e2e`
  - `npm run verify`
- Pick the lightest useful layer for the risk, but do not skip automated coverage when the repo already has a suitable seam.
- New UI behavior should extend Playwright E2E coverage when the flow is user-critical, regression-prone, or difficult to validate reliably through lower layers.

## Code Quality

- Remove dead code, unused branches, stale helpers, and abandoned exports in touched areas instead of leaving cleanup for later.
- Prefer narrow helpers near the feature they support; avoid growing catch-all utility modules without a clear cross-feature need.
- New abstractions must solve a real complexity problem or serve at least two concrete call sites.
- Avoid `TODO` / `FIXME` drift in committed code. If work must be deferred, document it in the agent handoff or relevant docs.
- New dependencies should be justified in the change summary and should favor stack choices already present in the repo when reasonable.

## React And State

- Use `useMemo` and `useCallback` when they support an existing hot path, dependency-sensitive behavior, or surrounding code style. Do not add prophylactic memoization.
- Prefer focused Zustand selectors and local state ownership over prop drilling mutable state deep through the tree.
- New routes and components must account for loading, empty, error, and offline or degraded states where applicable.

## Security And Boundaries

- Keep renderer and main-process boundaries typed and centralized through `electron/ipc/types.ts` and the preload bridge.
- Never widen vault write scope or bypass prefix validation.
- Treat auth sessions, provider keys, and filesystem access as sensitive paths that deserve narrow, explicit handling.
- Never log raw secrets, provider keys, or private chat bodies to the console or cloud tables.

## Testability

- Add stable selectors or semantics for new user-critical UI actions when Playwright coverage is appropriate.
- Electron startup and workspace behavior should remain deterministic under an isolated test `userData` directory.
- Prefer the preview workspace as the seeded surface for smoke and regression tests unless the scenario specifically depends on personal workspace behavior.

## Data Standards

- Vault markdown notes use YAML frontmatter with `title`, `created`, `updated`, `sources`, `tags`, and `type`.
- Note filenames are `kebab-case.md`.
- Graph edges come from `[[bracket links]]` between notes.
- Session titles must stay at six words or fewer.
- Never log private message bodies to cloud tables; only usage and operational metadata may leave the device.

## Definition Of Done

- New users can choose a vault, authenticate, and begin a chat quickly.
- Every major route handles loading, error, and empty states gracefully.
- Chat, extraction, graph, notes, and ingest flows all degrade cleanly when Supabase or AI providers are unreachable.
- Code additions keep the repository coherent for the next agent. If a new pattern is introduced, document it here or in `docs/schema.md`.
