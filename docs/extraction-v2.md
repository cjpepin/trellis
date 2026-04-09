# Conversation Extraction V2

Status: Proposed implementation spec
Owner: Product + engineering
Last updated: 2026-04-07

## 1. Why this exists

Trellis wins when chats reliably become durable, high-signal notes that connect to the right existing ideas.

Today, extraction is already partially model-driven:

- Chat sessions trigger extraction after inactivity or when the user leaves a session.
- The extraction service asks an LLM for JSON note updates.
- If the model fails, the app falls back to a heuristic note generator.
- Notes are written into the vault and graph links are rebuilt from `[[wiki links]]`.

This is a good first version, but it is not yet strong enough to be the product's signature feature. The current pipeline still has four structural weaknesses:

1. The extractor sees the transcript and a note index, but not the content of the most relevant existing notes.
2. Guardrails are mostly prompt-only instead of being enforced in code.
3. Local inference is not a first-class runtime, which weakens privacy and offline value.
4. The output contract is shallow, so the app cannot distinguish a strong update from a weak one.

This document defines the next version of extraction so conversation digestion becomes a real moat rather than a nice extra.

## 2. Product thesis

Trellis should treat note creation as a careful editorial workflow, not a raw summarization task.

The extractor should behave like a quiet research assistant:

- It notices only durable knowledge.
- It prefers merging into the right existing note over creating new pages.
- It links notes based on meaning, not keyword overlap.
- It writes clear notes for the future self, not transcript summaries.
- It stays useful offline and private by default.

## 3. Goals

- Make extraction quality visibly better than the current transcript-to-note pass.
- Make interlinking accuracy improve as the vault grows instead of degrading.
- Make local extraction a first-class path without bundling heavyweight model weights into the app.
- Keep the app fast enough that background extraction still feels invisible.
- Preserve local-first behavior: note generation should still work when cloud services are unavailable, if a local runtime is installed.
- Keep the write path deterministic and safe even when the model output is imperfect.

## 4. Non-goals

- Do not turn Trellis into a general autonomous agent platform.
- Do not ship model weights inside the Electron bundle.
- Do not require local inference for first-time use.
- Do not add sprawling note schemas or cloud-dependent memory systems.
- Do not optimize for one-shot perfect extraction of every transcript. The goal is steady, compounding quality.

## 5. User outcome

After this ships, a user should feel:

- "The app notices what matters."
- "It updates the right note instead of making duplicates."
- "The links are surprisingly coherent."
- "I trust it more because it works locally and does not feel random."

## 6. Product decisions

### 6.1 Runtime strategy

Trellis will support three extraction modes:

1. `Auto` (recommended)
   Uses local extraction when a supported local runtime is available. Falls back to cloud extraction when local is unavailable and the user is authenticated.
2. `Local only`
   Uses only a local runtime. If unavailable, extraction is skipped and the user gets a calm setup prompt.
3. `Cloud only`
   Uses the existing Supabase Edge Function path.

Default for new users:

- `Auto`
- Cloud extraction still works out of the box.
- The app gently recommends enabling local extraction for better privacy and offline reliability.

### 6.2 Local runtime choice

Primary local runtime: `Ollama`

Why:

- Headless local API at `http://localhost:11434/api`
- Simple install story
- Good model ecosystem
- Supports JSON or JSON-schema-shaped chat output
- Works well with on-demand model downloads

Developer-friendly secondary runtime: `LM Studio`

- Useful for local experimentation and debugging
- Not the primary product runtime for V2

V2 implementation requirement:

- Build a provider abstraction so we can add `LM Studio` later without changing the orchestration layer.
- Ship only the `Ollama` provider in the first implementation pass.

### 6.3 Recommended local models

We will support a small set of curated local extraction models rather than an open-ended free-text model field.

Baseline options:

- `qwen3:4b`
  Best low-resource default. Small enough for many laptops and good enough for structured extraction.
- `gemma3:12b`
  Recommended quality tier for users with stronger hardware.
- `mistral-small`
  High-quality option for power users on larger-memory machines.

Default recommendation logic:

- Low-resource device: suggest `qwen3:4b`
- Mid/high-resource device: suggest `gemma3:12b`
- Power-user manual upgrade: `mistral-small`

Embeddings model:

- `nomic-embed-text-v2-moe` for note retrieval

Rules:

- Do not auto-download any model without explicit user consent.
- Do not expose dozens of models in settings.
- Present a short curated list with disk size and expected quality.

## 7. Principles for V2 extraction

### 7.1 Extract only durable knowledge

The extractor should usually do nothing unless a conversation produces one of these:

- a decision
- a stable concept or framework
- a project artifact or plan
- a source summary worth re-reading
- a synthesis that connects existing ideas
- a correction to something already stored

### 7.2 Prefer note evolution over note proliferation

The default action is:

- `append` to an existing note if the conversation adds detail
- `rewrite` only when a note should materially change shape
- `create` only when the knowledge truly does not belong anywhere else

### 7.3 Retrieval before writing

The model should not guess related notes from titles alone. It should see the actual content of the most relevant existing notes before proposing changes.

### 7.4 Prompt guardrails are necessary but insufficient

Every important rule must be enforced twice:

- once in the extraction prompt
- once in deterministic code after the model responds

### 7.5 Local-first means graceful degradation

If the local runtime is missing or slow:

- chat must still work
- the app must never block the message UX
- extraction can queue, retry, or skip
- the user should be informed calmly

## 8. Proposed V2 architecture

### 8.1 Pipeline overview

1. Chat session becomes eligible for extraction.
2. A background extraction job is created locally.
3. The orchestrator builds a retrieval query from the latest durable transcript delta.
4. The app retrieves the most relevant existing notes using embeddings.
5. The extractor receives:
   - transcript delta
   - session metadata
   - relevant note bodies
   - placeholder targets
   - extraction policy prompt
   - strict JSON schema
6. The model returns a structured patch proposal.
7. Deterministic guardrails validate, normalize, and possibly reject parts of the patch.
8. Approved updates are written to the vault.
9. The graph index and retrieval index are refreshed.
10. The user sees a subtle result toast only when changes were applied.

### 8.2 New core modules

- `ExtractionOrchestrator`
  Owns scheduling, provider choice, retries, and the overall pipeline.
- `ExtractionProvider`
  Interface for `CloudExtractionProvider` and `OllamaExtractionProvider`.
- `RetrievalIndex`
  Maintains embeddings for notes and returns top relevant note chunks.
- `ExtractionGuardrails`
  Validates and normalizes structured model output before writes.
- `ExtractionPolicy`
  The canonical natural-language instruction set for the model.

### 8.3 Source of truth rules

- Natural-language prompt text remains canonical in `supabase/functions/_shared/prompts.ts`.
- Shared extraction schema and deterministic validation rules live in shared TypeScript modules, not duplicated strings.
- Vault writes remain in Electron IPC and retain the current vault path enforcement.

## 9. Guardrail design

The user's original idea of "an agent instruction file with guardrails" is directionally right, but V2 should split that into layers:

### 9.1 Layer 1: policy prompt

Canonical instruction set for the model:

- what counts as durable knowledge
- when to create vs append vs rewrite
- how to choose links
- how to resolve placeholder notes
- how to avoid transcript-style writing
- how to handle uncertain facts

This remains the single source of truth for model behavior.

### 9.2 Layer 2: strict output schema

The model must return a typed patch proposal, not free-form markdown instructions.

Required fields per update:

- `operation`: `create | append | rewrite | noop`
- `targetSlug`
- `targetTitle`
- `targetType`
- `summary`
- `body`
- `tags`
- `links`
- `evidence`
- `confidence`

`evidence` should reference transcript spans or retrieved note IDs so the app can reason about why an update exists.

### 9.3 Layer 3: deterministic validation

The app must enforce all of the following before writing:

- slug is valid kebab-case
- operation is allowed for the target state
- note type is one of the allowed wiki note types
- tags are unique and within count limits
- links either resolve to existing notes or valid placeholders
- appends do not repeat the entire note body
- rewrites are only allowed when confidence and evidence thresholds pass
- duplicate updates to the same target are merged before writing
- empty or trivial bodies are rejected

### 9.4 Layer 4: write-time safety

Before saving a note:

- preserve existing `created`
- update `updated`
- merge tags deterministically
- increment `sources` only when appropriate
- preserve vault path guarantees

## 10. Retrieval design

### 10.1 Why retrieval is mandatory

The current extractor mostly knows only note titles, slugs, and tags. That is not enough for high-quality linking once the vault becomes large. V2 will retrieve note content before extraction.

### 10.2 Retrieval unit

Store embeddings for:

- full notes shorter than a threshold
- section chunks for longer notes

Recommended first-pass chunking:

- split on markdown headings
- max chunk target around 600 to 900 tokens
- include note title and heading path in the embedded text

### 10.3 Retrieval inputs

The retrieval query is built from:

- the unextracted transcript delta
- session title candidate
- attached context summaries
- explicit `[[note links]]` already present in the chat

### 10.4 Retrieval outputs

Return:

- top `N` exact note matches
- top `N` related section chunks
- placeholder targets that already exist in the graph

V2 default:

- 6 retrieved note chunks max
- 3 exact title or explicit-link matches always included when available

### 10.5 Retrieval constraints

- Retrieval runs locally.
- Retrieval data never leaves the device in `Local only` mode.
- In `Auto` mode, retrieved note bodies should still stay local when the local provider is chosen.

## 11. Note-writing contract

### 11.1 Allowed operations

- `noop`
  No write should occur.
- `create`
  Create a brand-new note or fill a placeholder target.
- `append`
  Add a new section or concise update to an existing note.
- `rewrite`
  Replace the note body when the existing note is shallow, stale, or structurally wrong.

### 11.2 Rules for `create`

- Only when no relevant existing note is a better home.
- Should be the minority of operations.
- Must include at least one meaningful internal link when related notes exist.

### 11.3 Rules for `append`

- Preferred default.
- Should add a new section, correction, or concrete detail.
- Must not restate the whole note.

### 11.4 Rules for `rewrite`

- Use sparingly.
- Only when the note becomes better as a coherent whole than as an appended section.
- Requires higher confidence than `append`.

## 12. Settings and UX

### 12.1 New settings

Add an `Extraction` section to Settings with:

- extraction mode: `Auto`, `Local only`, `Cloud only`
- local runtime status
- curated local model picker
- model download / remove actions
- quality preset: `Balanced`, `High quality`
- background extraction toggle
- debug logging toggle for local development only

### 12.2 Chat UX

The chat view should keep the existing calm behavior:

- extraction remains background work
- no modal interruptions
- no spinners in the message thread

Allowed status copy:

- `Extracting notes locally…`
- `Waiting for local model…`
- `Local extraction unavailable. Cloud fallback used.`

### 12.3 First-run local setup

If the user selects `Local only` without Ollama installed:

- show a calm setup card
- explain what local extraction gives them
- include install instructions and a runtime check button
- do not block the rest of the app

## 13. Performance budgets

Budgets for V2:

- extraction should never block chat streaming
- orchestration kickoff under 100ms on the UI thread
- retrieval under 300ms for typical vaults under 5k notes
- local extraction under 12s for the baseline model on a reasonable laptop
- note write + graph refresh under 500ms after a valid patch

If a run exceeds the budget:

- keep it in the background
- surface only a subtle status
- never freeze the renderer

## 14. Privacy and data rules

- Message bodies and note contents must not be written to cloud tables.
- `Local only` mode must avoid sending transcript or note content to third-party providers.
- `Auto` mode must clearly indicate when cloud fallback is used.
- Retrieval embeddings stay local.
- Model download choice is explicit and user-controlled.

## 15. Data model changes

V2 adds local extraction metadata tables in the Electron database.

### 15.1 New tables

`extraction_jobs`

- `id`
- `session_id`
- `vault_id`
- `status`
- `provider`
- `model`
- `created_at`
- `started_at`
- `finished_at`
- `error_message`
- `transcript_start_index`
- `transcript_end_index`

`note_embeddings`

- `note_slug`
- `chunk_id`
- `heading_path`
- `content_hash`
- `embedding_vector`
- `updated_at`

`extraction_runs`

- `id`
- `job_id`
- `operation_count`
- `created_count`
- `appended_count`
- `rewritten_count`
- `provider`
- `model`
- `duration_ms`
- `fallback_used`

Implementation note:

- If storing vectors in PGlite becomes awkward, V2 may store embeddings as JSON arrays first. Optimize only after the workflow is correct.

## 16. Step-by-step implementation plan

This section is the execution order. Follow it in sequence.

### Phase 1: Stabilize the extraction contract

Goal:

- make extraction output explicit and enforceable before changing runtimes

Tasks:

1. Create shared extraction types for the V2 patch format.
2. Replace the current loose JSON parsing with strict schema validation.
3. Rename `update` to `rewrite` in the internal contract to make intent clearer.
4. Add `noop`, `confidence`, and `evidence` fields.
5. Merge duplicate updates targeting the same slug before applying writes.
6. Ensure `linkedTo` is no longer a dead field; either enforce it or replace it with `links`.
7. Add unit tests for valid and invalid patch outputs.

Files to touch:

- `supabase/functions/_shared/prompts.ts`
- `supabase/functions/_shared/models.ts`
- `src/lib/api.ts`
- `src/hooks/useApplyExtraction.ts`
- `electron/ipc/types.ts`
- new shared extraction contract module

Exit criteria:

- cloud extraction still works
- malformed model output is safely rejected
- writes are more deterministic than today

### Phase 2: Build the retrieval index

Goal:

- let extraction see relevant existing note content, not just titles

Tasks:

1. Add note chunking logic in Electron.
2. Add embeddings storage tables.
3. Add a local embeddings provider using Ollama.
4. Rebuild embeddings when notes change.
5. Add a retrieval query that returns the top relevant note chunks.
6. Always include explicitly linked notes from the transcript when available.
7. Add a background index rebuild command for existing vaults.

Files to touch:

- `electron/lib/database.ts`
- `electron/ipc/vault.ts`
- new `electron/lib/retrieval/*`
- new typed IPC methods if renderer needs retrieval status

Exit criteria:

- given a transcript, the app can retrieve the most relevant note bodies locally
- updated notes refresh their embeddings automatically

### Phase 3: Add the local provider abstraction

Goal:

- make local extraction a first-class execution path

Tasks:

1. Introduce `ExtractionProvider` and `ExtractionRuntimeStatus` interfaces.
2. Implement `CloudExtractionProvider` around the current Supabase path.
3. Implement `OllamaExtractionProvider`.
4. Add runtime detection and health checks.
5. Add model availability checks and local model metadata.
6. Add structured-output requests using the V2 schema.

Files to touch:

- `src/lib/api.ts`
- new `electron/lib/extraction/providers/*`
- new `electron/ipc/extraction.ts`
- `electron/preload.ts`
- `electron/main.ts`
- `electron/ipc/types.ts`

Exit criteria:

- the app can choose cloud or local extraction at runtime without changing the write path

### Phase 4: Move orchestration local

Goal:

- make extraction scheduling and fallback decisions happen on-device

Tasks:

1. Move extraction orchestration out of the renderer and into Electron-owned logic where appropriate.
2. Keep the renderer responsible for initiating background work, not for provider logic.
3. Create persistent extraction jobs so retries survive route changes.
4. Add retry policy:
   - local temporary failure: retry once
   - local unavailable in `Auto`: fall back to cloud
   - local unavailable in `Local only`: skip and notify
5. Preserve the current inactivity trigger and session-switch trigger.

Files to touch:

- `src/routes/Chat.tsx`
- new `electron/lib/extraction/orchestrator.ts`
- new `electron/lib/extraction/jobs.ts`

Exit criteria:

- route changes no longer threaten extraction continuity
- fallback policy is consistent and testable

### Phase 5: Add settings and local setup UX

Goal:

- make the new system understandable and controllable

Tasks:

1. Add `Extraction` settings UI.
2. Show local runtime status and model state.
3. Add model install / remove actions.
4. Add copy for `Auto`, `Local only`, and `Cloud only`.
5. Add a non-invasive setup card when local extraction is selected but unavailable.

Files to touch:

- `src/routes/Settings.tsx`
- `src/lib/settings.ts`
- `electron/ipc/types.ts`

Exit criteria:

- a user can intentionally choose their extraction behavior
- setup does not feel technical or brittle

### Phase 6: Improve write quality and note coherence

Goal:

- make note updates feel editorially strong

Tasks:

1. Improve append formatting rules.
2. Prevent duplicate headings and transcript-like bullets.
3. Normalize links against retrieved targets and placeholders.
4. Reject weak note bodies below a quality threshold.
5. Ensure tag merging stays deterministic.
6. Add patch post-processing so model output matches house style.

Files to touch:

- `src/hooks/useApplyExtraction.ts`
- `electron/ipc/vault.ts`
- new `electron/lib/extraction/guardrails.ts`

Exit criteria:

- note quality is visibly stronger in repeated manual testing
- duplicate pages are rarer
- interlinking is more coherent

### Phase 7: Add observability and developer tools

Goal:

- make extraction debuggable without exposing private content by default

Tasks:

1. Add local-only debug logs for provider choice, duration, and validation failures.
2. Add a developer panel or logs for the last extraction run.
3. Add a manual "Re-run extraction for this session" command for testing.
4. Keep private content out of cloud telemetry.

Files to touch:

- `src/routes/Chat.tsx`
- `src/routes/Settings.tsx`
- new `electron/lib/extraction/debug.ts`

Exit criteria:

- developers can understand why a run succeeded, failed, or was downgraded

### Phase 8: Roll out and tune

Goal:

- ship safely and refine quality with real usage

Tasks:

1. Hide local extraction behind a feature flag during initial implementation.
2. Run side-by-side comparisons between current extraction and V2 on a transcript corpus.
3. Tune prompts and deterministic thresholds.
4. Remove the old heuristic fallback only after V2 local and cloud outputs are stable.

Exit criteria:

- V2 consistently beats the current path on note usefulness and duplicate avoidance

## 17. Acceptance criteria

V2 is done when all of the following are true:

- Users can choose `Auto`, `Local only`, or `Cloud only`.
- Ollama-backed local extraction works end-to-end.
- Extraction uses retrieved note content, not just note titles and tags.
- Structured outputs are schema-validated before writes.
- The write path rejects malformed or weak patches safely.
- Duplicate-note creation is materially lower in manual evaluation.
- Existing placeholder notes are reused correctly.
- The app remains useful when cloud extraction is unavailable.
- The renderer never blocks on extraction work.

## 18. QA plan

Create a transcript evaluation set with at least these cases:

- trivial chat that should produce no notes
- single durable concept that should create one note
- follow-up chat that should append to an existing note
- ambiguous topic that should prefer an existing placeholder
- conversation that mentions multiple related existing notes
- correction to an earlier mistaken note
- source-ingest transcript that should become a `source-summary`
- large vault case where retrieval quality matters

For each case, manually score:

- correct no-op behavior
- correct target note choice
- note quality
- link quality
- duplicate avoidance
- latency

## 19. Risks and mitigations

Risk: local models produce weaker writing than cloud models

Mitigation:

- use retrieval
- enforce structured outputs
- keep cloud fallback in `Auto`
- curate only a few tested local models

Risk: model installation feels heavy

Mitigation:

- do not bundle weights
- make local extraction optional
- provide one-click setup guidance

Risk: embeddings add complexity

Mitigation:

- start with simple local embeddings
- keep the chunking strategy straightforward
- optimize storage later

Risk: prompt drift between cloud and local behavior

Mitigation:

- keep one canonical extraction policy prompt
- share the same schema and validation layer for both providers

## 20. Deferred work

These are explicitly out of scope for V2:

- automatic note consolidation across the whole vault
- autonomous multi-step agents that browse the vault repeatedly
- user-facing confidence scores on notes
- collaborative or cloud-synced extraction review workflows
- vector search over external documents beyond the vault

## 21. Immediate next build order

If implementation starts now, do this next:

1. Land the V2 extraction contract and validation layer.
2. Land retrieval and local embeddings.
3. Land the Ollama provider and runtime checks.
4. Move orchestration into a local extraction service.
5. Add settings UI and model setup flow.
6. Run side-by-side evaluation before making `Auto` prefer local by default.

## 22. References

Official references used while writing this spec:

- Ollama API docs: https://docs.ollama.com/api/introduction
- Ollama chat API: https://docs.ollama.com/api/chat
- Ollama model library:
  - https://ollama.com/library/qwen3
  - https://ollama.com/library/gemma3
  - https://ollama.com/library/mistral-small
  - https://ollama.com/library/nomic-embed-text-v2-moe
- LM Studio developer docs: https://lmstudio.ai/docs/developer
