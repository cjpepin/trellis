# Trellis differentiation — phased roadmap

This document is the canonical implementation guide for staying distinct from Obsidian-class PKM tools: **conversation-first compound memory**, **Strands** (user-facing durable units), **provenance**, and **intent-shaped retrieval**. Internal code may still use `note` / `WikiNote` types until an optional rename phase.

## Terminology (frozen)

| Term | Meaning |
|------|---------|
| **Strand** | User-visible name for a durable markdown page in the vault (still one `kebab-case.md` file). |
| **Vault** | User-owned folder on disk (unchanged). |
| **Compound memory** | Chat and extraction that update Strands over time with traceable lineage. |

## Phase 0 — Baseline (complete)

- **TypeScript:** `tsconfig.json` does not enable `noUnusedLocals`; rely on `npm run check` and cleanup in touched files.
- **Dead code:** Remove only proven-unused code in modules touched by a phase; optional Knip/ts-prune is not in CI yet.
- **Routes:** [`LegacyWikiNotesRedirect`](../../src/App.tsx) keeps `#/wiki` bookmarks working → `#/notes`.

### User-visible string inventory (hot paths)

| Location | Topic |
|----------|--------|
| [`Sidebar.tsx`](../../src/components/shared/Sidebar.tsx) | Nav label for `/notes` |
| [`App.tsx`](../../src/App.tsx) | Extraction completion toasts |
| [`Chat.tsx`](../../src/routes/Chat.tsx) | Manual save / extraction toasts |
| [`Wiki.tsx`](../../src/routes/Wiki.tsx) | List header, empty states, create placeholders |
| [`InputBar.tsx`](../../src/components/chat/InputBar.tsx) | Composer pin copy |
| [`Graph` route](../../src/routes/Graph.tsx) / [`ForceGraph`](../../src/components/graph/ForceGraph.tsx) | Empty graph copy |

## Phase 1 — UX copy (complete)

- Strands language in nav, toasts, and key chat/wiki strings.
- URLs stay `/notes` for compatibility.

## Phase 2 — Strand-first browsing (complete)

- Wiki list: tabs **Recent** (default), **From chats**, **Explorer** (folder tree).
- Optional frontmatter keys documented in [`docs/schema.md`](../schema.md).

## Phase 3 — Provenance (complete)

- SQLite: query `wiki_ops` joined with `chat_sessions` by vault (no new table required for baseline).
- IPC: list sessions that touched Strands; latest touch per file for the Strand viewer.
- Privacy: ids and titles only — no message bodies in SQLite beyond existing message tables.

## Phase 4 — Extraction V2 alignment (complete)

MVP alignment with [`docs/extraction-v2.md`](../extraction-v2.md) §7.3 (retrieval before writing) and shared behavior across features:

- **Related note bodies in the prompt:** [`shared/extraction/buildPrompt.ts`](../../shared/extraction/buildPrompt.ts) includes full retrieved chunk content under “Relevant Existing Notes,” not just the index.
- **Single default retrieval width:** [`relatedNotesRetrievalDefaultLimit`](../../shared/extraction/config.ts) (`8`) is used for conversation extraction ([`electron/lib/extraction/orchestrator.ts`](../../electron/lib/extraction/orchestrator.ts)), chat context assembly ([`electron/lib/chat/context.ts`](../../electron/lib/chat/context.ts)), ingest from chat ([`src/routes/Chat.tsx`](../../src/routes/Chat.tsx)), and the default when `limit` is omitted in [`searchRelevantNotes`](../../electron/lib/retrieval/index.ts) / retrieval IPC.
- **Deterministic enforcement (partial V2 §7.4 / §9.3):** structured output is validated in [`shared/extraction/validate.ts`](../../shared/extraction/validate.ts); writes are prepared in [`electron/lib/extraction/guardrails.ts`](../../electron/lib/extraction/guardrails.ts) with thresholds from [`shared/extraction/config.ts`](../../shared/extraction/config.ts) (`extractionThresholds`).

**Not in this phase (see extraction-v2 backlog):** deeper `evidence` / confidence gating, duplicate-create merges, or further prompt-only policy work beyond what is already in [`supabase/functions/_shared/prompts.ts`](../../supabase/functions/_shared/prompts.ts) and shared validation.

## Phase 5 — Graph overlays (complete)

- Main graph view: emphasis mode **Links** (default, connection degree) vs **Recency** (by note `updated` from the vault index).

## Phase 6 — Optional internal rename (light)

- `StrandNote` exported as a type alias of `WikiNote` in [`electron/ipc/types.ts`](../../electron/ipc/types.ts) for gradual adoption.

## Dead-code rules (every phase)

1. Touched areas only unless a split deletes a whole submodule.
2. Before merge: `npm run check`; run `npm run test:node` when DB/IPC/extraction/graph changes; use `npm run verify` for large refactors.
3. Prefer deleting duplicate toast paths and obsolete branches when consolidating.

## Out of scope

- Plugin/theme marketplace parity with Obsidian.
- Proprietary non-markdown vault formats.
