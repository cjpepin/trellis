# AGENTS.md

This repository follows **[`docs/mvp.md`](docs/mvp.md)** as the product specification for agents. **Supabase** is the system of record for identity, billing, and the **cloud-backed** product dataset (workspaces, notes, chat, Strands metadata, provider keys, and preferences). Edge Functions implement chat, session extraction, notes CRUD, graph, migration import, and related HTTP APIs.

## Working Principles

- **Cloud-first product data.** Signed-in users sync Strands (notes), chat sessions, graph links, and preferences through Postgres and Supabase Storage. Electron remains a **client**: IPC covers desktop-only capabilities (secure storage, filesystem pickers, local preview workspaces, legacy bucket-on-disk tooling). A **web** build can boot with `TrellisApiClient` + Supabase when `VITE_*` is configured; IPC-only flows still require the desktop app.
- **Transition:** Local SQLite and on-disk bucket folders may still exist for migration and desktop-only paths until cutover is complete; new features should target the shared cloud layer (`src/lib/cloud/`, `shared/cloud/types.ts`, Edge Functions) unless explicitly desktop-scoped.
- Treat UX as a feature. Empty states, loading states, error recovery, and first-run setup are part of the MVP, not polish.
- Keep TypeScript in strict mode. Do not introduce `any`; use `unknown` and narrow at boundaries.
- Favor small files with one primary export. Split helpers before functions become difficult to scan.
- No inline styles. Tailwind classes plus `apps/web/src/globals.css` variables only.
- Respect secure boundaries. The renderer never touches Node APIs directly; all privileged work goes through typed IPC.
- Keep note writes inside the configured bucket. Enforce prefix checks before every write or copy operation.

## Agent Workflow

- Use the repo-local role skills in `.codex/skills/` and the operator docs in `docs/agents/`.
- Default feature flow is: `product-plan-agent` -> `senior-dev-agent` -> `senior-tester-agent` -> `senior-qa-agent`.
- Use `repo-refactor-agent` only for explicit cleanup, security, or maintenance requests, or as a separate follow-up pass after feature delivery.
- Keep handoffs structured using `docs/agents/handoffs.md` so downstream agents inherit exact acceptance criteria, verification expectations, and known risks.

## Architecture Rules

- Electron owns local capabilities: SQLite, bucket reads and writes, secure token storage, PDF parsing, and web clipping.
- React owns presentation, route composition, and optimistic UX.
- Zustand owns app state. Avoid prop drilling past two levels.
- Supabase owns auth sessions, subscription metadata, usage counters, and AI orchestration through Edge Functions.
- Prompts live only in `supabase/functions/_shared/prompts.ts`.
- IPC channel names and payload contracts live in the **`@trellis/contracts`** package (`packages/contracts`, also re-exported from `apps/desktop/electron/ipc/types.ts` for the preload/main boundary).
- **Strands extraction:** Cloud-backed chats run **server-side** session extraction via the `chat-session-extract` Edge Function (BYOK keys in `provider_credentials`); the renderer applies structured updates with the same guardrails as desktop (`useApplyExtraction`). On-device extraction via `node-llama-cpp` still exists for **local-only / desktop** workspaces (`embeddedExtractionGgufFilename` / `defaultLocalExtractionModelId` in `packages/shared/src/extraction/config.ts`); see [`docs/extraction-routing.md`](docs/extraction-routing.md). Dev eval: `pnpm run eval:extraction:ollama` (optional).
- **Guest sessions (desktop + web):** When Supabase is configured and “stay signed in” is on, the client may create a **Supabase anonymous** session so users can use hosted chat within trial limits without an email. On **Electron personal**, Strands and chat history stay **local** until the user signs up and enables **cloud sync** (`settings.cloudSyncEnabled`, default on for registered users). The **web** client still uses the cloud workspace for guests (no browser local bucket yet). **Upgrading a guest** uses `supabase.auth.updateUser({ email, password })` so the **same user id** and **`profiles` row** (quota) stay tied to the account. Signing **in** with an existing email while still anonymous signs the anonymous session out first, then uses `signInWithPassword`. **`cloudSyncEnabled`** is also stored under **`user_preferences.platform_json`** (merged on PATCH) so multiple desktops can pick up the same toggle when cloud sync is active.
- **Web vs Electron detection and Vite stub:** `apps/web/src/main.tsx` may install a rejecting `window.trellis` proxy for `pnpm run dev:web` in a plain browser. That stub sets `TRELLIS_VITE_DEV_STUB_MARK` on its target (see `apps/web/src/lib/platform/runtime.ts`). **`hasElectronPreloadBridge()`** treats the stub as non-Electron so web bootstrap always runs; do not detect desktop by “any truthy `window.trellis.*`” because nested proxies can lie. The real preload in `apps/desktop/electron/preload.ts` must never set that symbol. First-load bootstrap (web placeholder vs IPC `bootstrap()`, Supabase subscriptions, cleanup) lives in **`apps/web/src/lib/bootstrap/runInitialBootstrap.ts`**; `App.tsx` wires it into React state only.

### AI providers (OpenAI and Anthropic)

Chat models from **OpenAI and Anthropic** are both first-class. Ancillary cloud features (speech, transcription, inline images, and similar) may be implemented against one vendor’s HTTP API behind Supabase Edge Functions today, but implementations must stay **easy to extend** and **honest about parity**.

- **Avoid one-sided product and code assumptions.** Do not bake in “always OpenAI” or “always Anthropic” for shared user flows unless the capability is truly exclusive to that API. Prefer capability checks, shared IPC types (`@trellis/contracts`), preload contracts, and neutral naming at boundaries.
- **Isolate provider-specific HTTP.** Keep vendor request bodies, headers, and parsing in dedicated server-side helpers or branches; keep Electron IPC and renderer types **provider-neutral** (audio bytes and MIME type, not raw OpenAI response shapes).
- **Call out provider gaps in handoffs.** If a feature only works with a given key, plan, or API today, document that explicitly and what would be needed for the other provider or a second backend.
- **Routing and prompts** that differ by provider belong alongside the Edge Function chat or media orchestration layer, not scattered through the React tree.

## UX Standards

- Match the considered-dark design system from `mvp.md`, including the warm amber accent and restrained motion.
- Cold-start states must feel intentional. Blank panels are a bug unless the user is actively editing.
- Stream chat output token-by-token and prefer subtle pulses or skeletons over spinners.
- Use clear, steady language in UI copy. The product should feel calm and precise, not chatty.
- Respect `prefers-reduced-motion` for route and message entrance animations.

## Verification Expectations

- Every behavior change must run `pnpm run check`.
- Canonical automated verification commands are:
  - `pnpm run test:node`
  - `pnpm run test:e2e`
  - `pnpm run verify`
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

- Keep renderer and main-process boundaries typed and centralized through **`@trellis/contracts`** (desktop re-exports via `apps/desktop/electron/ipc/types.ts`) and the preload bridge.
- Never widen bucket write scope or bypass prefix validation.
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
- Code additions keep the repository coherent for the next agent. If a new pattern is introduced, document it here or in `docs/schema.md`. Multi-provider behavior and known single-provider limitations belong in this file or in the active agent handoff.
