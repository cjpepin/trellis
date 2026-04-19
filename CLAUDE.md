# CLAUDE.md

This file is the Claude Code operating guide for Trellis.

## Core Operating Principles (HIGH PRIORITY)

These rules override stylistic preferences and should be followed unless explicitly told otherwise.

### 1. Minimize Token Usage While Preserving Quality
- Be concise by default.
- Avoid unnecessary explanation, repetition, or exploration.
- Prefer the smallest correct answer over a comprehensive one.
- Do not restate context unless required for correctness.

### 2. Deterministic Execution (No Exploration Mode)
- Do NOT explore multiple approaches unless explicitly asked.
- Choose the most likely correct solution and proceed.
- Avoid speculative reasoning or “just in case” changes.

### 3. Minimal Surface Area Changes
- Make the smallest possible change to solve the problem.
- Do not refactor unrelated code.
- Do not rewrite entire files unless necessary.

### 4. Context Discipline
- Read the smallest set of files required.
- Do not load or analyze large files unless directly relevant.
- Prefer partial reads and targeted search (`rg`) over full file scans.

### 5. Idempotent and Stable Behavior
- Ensure repeated runs do not create duplicate or divergent results.
- Prefer updates over new creations when modifying existing artifacts.

---

## Output Rules (CRITICAL)

Always follow structured, minimal outputs.

### For bug fixes:
1. Root cause (1–2 lines)
2. Fix summary (1–2 lines)
3. Minimal patch (only changed code)

### For feature work:
1. Plan (concise, no fluff)
2. Implementation (scoped, minimal)
3. Verification steps

### General:
- No unnecessary prose
- No long explanations unless explicitly requested
- Avoid markdown verbosity unless it improves clarity

---

## Project Summary

Trellis is a local-first AI knowledge desktop app built with Electron, React,
TypeScript, SQLite, local markdown vaults, and Supabase.

The core product loop:

1. A user chats with an AI assistant.
2. Trellis preserves the conversation locally in SQLite.
3. On-device extraction turns durable ideas into markdown notes in the user's
   vault.
4. The graph and wiki views help the user browse a growing knowledge base.

The product promise is local-first compounding knowledge. Chats, notes, graph
data, and degraded/offline states must keep working as much as possible when
cloud services are unavailable.

## Read First

Before changing code, read the smallest useful set of these files:

- `AGENTS.md` - repository contract, security rules, verification expectations.
- `README.md` - setup, commands, repository layout, preview workspace.
- `docs/mvp.md` - product intent, UX direction, implementation notes.
- `docs/agents/README.md` - role workflow for planning, dev, test, and QA.
- `docs/agents/handoffs.md` - structured handoff templates.
- `docs/schema.md` - vault markdown, frontmatter, graph, and note conventions.
- `docs/supabase-dx.md` - Supabase CLI wrapper and backend workflow.

Use `rg` for code search and prefer reading existing patterns before inventing
new abstractions.

## Current Architecture

The original MVP described a bespoke backend. This repo intentionally uses
Supabase instead:

- Supabase Auth owns identity.
- Postgres owns account, billing, usage, and subscription state.
- Supabase Edge Functions own AI chat, media orchestration, and webhooks.
- Electron owns local capabilities: SQLite, vault reads/writes, secure token
  storage, PDF parsing, web clipping, local extraction, and filesystem access.
- React owns presentation, routes, and optimistic UI.
- Zustand owns app state.

Do not add Express, Clerk, or a separate backend service unless a newer product
handoff explicitly changes the architecture.

## Repository Map

| Path | Responsibility |
| --- | --- |
| `src/` | React renderer, routes, components, hooks, stores, UI helpers |
| `electron/` | Main process, preload bridge, IPC handlers, local capabilities |
| `electron/ipc/types.ts` | The only home for IPC channel names and payload contracts |
| `shared/` | Cross-runtime types, config, validation, extraction/chat helpers |
| `supabase/` | Migrations, Edge Functions, shared server-side function helpers |
| `supabase/functions/_shared/prompts.ts` | The only home for prompt text |
| `tests/node/` | Node regression tests for contracts, data, and local logic |
| `tests/e2e/` | Playwright Electron tests for user-critical flows |
| `fixtures/` | Preview seed data and extraction evaluation fixtures |
| `scripts/` | Reset, Supabase, preview seed, and evaluation automation |

## Agent Workflow

Default feature flow:

1. `product-plan-agent`
2. `senior-dev-agent`
3. `senior-tester-agent`
4. `senior-qa-agent`

Use `repo-refactor-agent` only for explicit cleanup, security, maintenance, or
a separate follow-up pass after feature delivery.

When handing work between roles, preserve structured context using
`docs/agents/handoffs.md`. Do not replace a prior handoff with a loose summary.

For small direct edits, keep the change tightly scoped and still record what was
verified.

## Development Commands

```bash
npm run dev
npm run check
npm run test:node
npm run test:e2e
npm run verify
```

Useful focused commands:

```bash
npm run test:config
npm run test:contracts
npm run test:guardrails
npm run test:jobs
npm run test:preview-seed
npm run test:providers
npm run test:retrieval
npm run eval:extraction:heuristic
npm run eval:extraction:v2
npm run eval:extraction:ollama
```

Supabase commands are wrapped through `scripts/supabase.mjs`:

```bash
npm run supabase:doctor
npm run supabase:start
npm run supabase:status
npm run supabase:db:diff -- <name>
npm run supabase:types:gen
npm run supabase:backend:deploy
```

## Verification Expectations

- Run `npm run check` for every behavior change.
- Use the lightest test layer that catches the actual risk.
- Run `npm run test:node` for shared logic, extraction, vault, chat helpers,
  contracts, migrations-adjacent logic, and deterministic data behavior.
- Run `npm run test:e2e` for user-critical routes, workspace flows, settings,
  navigation, and durable Electron regressions.
- Run `npm run verify` before broad or release-like changes.
- If verification is skipped, state exactly what was skipped and why.

Prefer the preview workspace for smoke and regression coverage unless a scenario
specifically depends on personal workspace behavior.

## Coding Standards

- Keep TypeScript strict. Do not introduce `any`; use `unknown` and narrow at
  boundaries.
- Prefer small files with one primary export.
- Split helpers before functions become hard to scan.
- Use async/await rather than raw promise chains.
- Avoid prop drilling past two levels. Use focused Zustand selectors and local
  state ownership.
- Use `useMemo` and `useCallback` only when they support an existing hot path,
  dependency-sensitive behavior, or local code style.
- Remove dead code, unused branches, stale helpers, and abandoned exports in
  touched areas.
- Avoid `TODO` and `FIXME` drift. Put deferred work in a handoff or relevant doc.
- Justify new dependencies and prefer existing stack choices.

## UI And Styling

- No inline styles.
- Use Tailwind classes and `src/globals.css` variables.
- Match the considered-dark design system from the product docs: warm dark
  surfaces, restrained motion, calm copy, and the amber accent.
- Treat empty, loading, error, first-run, and degraded states as required UX.
- Stream chat output token-by-token.
- Prefer subtle pulses or skeletons over spinners.
- Respect `prefers-reduced-motion` for route and message entrance animations.
- New user-critical UI should include stable selectors or semantics for
  Playwright coverage when appropriate.

## Security Boundaries

- The renderer must never touch Node APIs directly.
- All privileged work goes through the typed preload and IPC boundary.
- Keep IPC channel names and payload contracts centralized in
  `electron/ipc/types.ts`.
- Treat renderer input as untrusted in the main process.
- Keep vault writes inside the configured vault. Enforce prefix checks before
  every write or copy operation.
- Treat auth sessions, provider keys, filesystem access, and user messages as
  sensitive.
- Never log raw secrets, provider keys, private chat bodies, or vault content to
  cloud tables or console output.

## AI Provider Rules

OpenAI and Anthropic chat models are both first-class.

- Do not bake in "always OpenAI" or "always Anthropic" for shared flows unless
  the capability is truly exclusive to one provider.
- Keep Electron IPC and renderer types provider-neutral.
- Isolate provider-specific request bodies, headers, and response parsing in
  Supabase Edge Function helpers or provider-specific branches.
- Prompts and provider routing belong with the Edge Function chat/media
  orchestration layer, not scattered through React components.
- If a feature only supports one provider, document the gap and what is needed
  for parity in the handoff or affected docs.

Ancillary cloud features such as speech, transcription, and inline images may
currently target one provider behind Edge Functions, but the design should stay
easy to extend and honest about parity.

## Local Extraction

On-device extraction is the default note-processing path when cloud extraction
is off or the session does not use a cloud chat model.

- Local extraction uses `node-llama-cpp` in the Electron main process.
- The GGUF path is under app user data and is configured by
  `embeddedExtractionGgufFilename` and `defaultLocalExtractionModelId` in
  `shared/extraction/config.ts`.
- Model weights are not bundled. First run downloads once.
- Override the download URL with `TRELLIS_EMBEDDED_EXTRACTION_MODEL_URL`.
- Set `TRELLIS_FEATURE_LOCAL_EXTRACTION=0` to disable on-device note processing.
- Optional cloud extraction for OpenAI/Anthropic chat sessions: `TRELLIS_FEATURE_CLOUD_EXTRACTION`
  (see `docs/extraction-routing.md`); on-device extraction remains the fallback when cloud fails.
- Optional dev eval against a running HTTP chat API:
  `npm run eval:extraction:ollama`.

## Data Standards

- Vault markdown notes use YAML frontmatter with `title`, `created`, `updated`,
  `sources`, `tags`, and `type`.
- Note filenames are `kebab-case.md`.
- Internal graph edges come from `[[bracket links]]`.
- Preserve missing links as ghost links so the UI can create stubs.
- Session titles must stay at six words or fewer.
- Thoughts are SQLite interaction-layer records, not markdown wiki files.
- Never write private message bodies to cloud tables. Only usage and operational
  metadata may leave the device.

## Supabase Rules

- Renderer Supabase keys must be publishable only.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` or `sb_secret_...` through `VITE_`
  variables.
- Migrations live in `supabase/migrations/`.
- Edge Functions live in `supabase/functions/`.
- Shared function helpers live in `supabase/functions/_shared/`.
- Generate database types with `npm run supabase:types:gen` after schema changes.
- For backend changes spanning SQL and functions, use the workflow in
  `docs/supabase-dx.md`.

## Git And Change Hygiene

- You may be in a dirty worktree. Do not revert changes you did not make unless
  the user explicitly asks.
- Keep edits scoped to the requested task.
- Do not run destructive commands such as `git reset --hard` or checkout files
  to discard work unless explicitly requested.
- Preserve user changes in files you touch. If unrelated edits exist, work around
  them.
- Summaries should call out changed files, verification run, known gaps, and
  follow-ups when relevant.

## Definition Of Done

A change is done when:

- The implementation respects local-first behavior and typed IPC boundaries.
- Relevant loading, empty, error, offline, and degraded states are handled.
- Vault writes remain inside the configured vault.
- Provider-specific behavior is isolated and documented.
- Useful automated verification has run, or skipped verification is explained.
- Handoff notes capture acceptance, verification, risks, and known gaps when the
  work moves to another role.

