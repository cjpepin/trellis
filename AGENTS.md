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

## Architecture Rules

- Electron owns local capabilities: SQLite, vault reads and writes, secure token storage, PDF parsing, and web clipping.
- React owns presentation, route composition, and optimistic UX.
- Zustand owns app state. Avoid prop drilling past two levels.
- Supabase owns auth sessions, subscription metadata, usage counters, and AI orchestration through Edge Functions.
- Prompts live only in `supabase/functions/_shared/prompts.ts`.
- IPC channel names and payload contracts live only in `electron/ipc/types.ts`.

## UX Standards

- Match the considered-dark design system from `mvp.md`, including the warm amber accent and restrained motion.
- Cold-start states must feel intentional. Blank panels are a bug unless the user is actively editing.
- Stream chat output token-by-token and prefer subtle pulses or skeletons over spinners.
- Use clear, steady language in UI copy. The product should feel calm and precise, not chatty.
- Respect `prefers-reduced-motion` for route and message entrance animations.

## Data Standards

- Wiki notes use YAML frontmatter with `title`, `created`, `updated`, `sources`, `tags`, and `type`.
- Wiki filenames are `kebab-case.md`.
- Graph edges come from `[[wiki links]]`.
- Session titles must stay at six words or fewer.
- Never log private message bodies to cloud tables; only usage and operational metadata may leave the device.

## Definition Of Done

- New users can choose a vault, authenticate, and begin a chat quickly.
- Every major route handles loading, error, and empty states gracefully.
- Chat, extraction, graph, wiki, and ingest flows all degrade cleanly when Supabase or AI providers are unreachable.
- Code additions keep the repository coherent for the next agent. If a new pattern is introduced, document it here or in `docs/schema.md`.

