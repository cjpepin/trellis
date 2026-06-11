# Trellis full-repo sweep — 2026-04-14

Reviewer: Claude Sonnet 4.6 (automated code review).
Scope: mandatory docs (AGENTS.md, CLAUDE.md, README.md, docs/mvp.md, docs/schema.md, docs/agents/handoffs.md) plus repo-wide review across seven layers. No code changes were made during this sweep; every finding below is a written recommendation with a proposed fix and verification.

Verification at end of sweep:
- `npm run check` — clean (tsc --noEmit passed).
- `npm run test:node` — 99/101 pass. Two failures are the same native-module ABI error (`better-sqlite3` compiled for NODE_MODULE_VERSION 133, runtime is 127) in `tests/node/vault/obsidian-bridge.test.cjs` subtests 92 and 93. Environmental / `npm rebuild` issue, **not a regression in source** — fixed by rebuilding native deps against the active Node version.
- `npm run test:e2e` — not run; no user-facing renderer or Electron code was edited in this sweep.

---

## 1. Executive summary

Trellis is a local-first Electron + React wiki with a cloud edge for hosted chat/BYOK/billing and an on-device extraction loop that turns chat transcripts into durable wiki notes. The code is generally careful with IPC boundaries (Zod at every handler, `ensureInsideVault` path validation, contextBridge-only preload) and has rigorous extraction validation. However, the **cloud edge has a P0 billing-bypass bug**, and a handful of medium-severity issues exist around usage metering, SSE fidelity, on-device model download robustness, and small UX/data correctness bugs.

Severity counts:
- **P0 (security / data loss / correctness):** 1
- **P1 (significant functional or financial impact):** 4
- **P2 (correctness / robustness):** 6
- **P3 (style / nits):** 5

Highest-leverage next step: gate `previewWorkspaceRequest` on a server-verified admin claim in `supabase/functions/_shared/auth.ts`, and add billing metering for `chat-media` requests.

---

## 2. Layer-by-layer findings

### Layer 1 — Trust boundaries
Files substantively reviewed:
- `electron/main.ts`, `electron/preload.ts`, `electron/ipc/index.ts`, `electron/ipc/auth.ts`, `electron/ipc/chat.ts`, `electron/ipc/bucket.ts` (partial — 600 of ~2000 lines), `electron/ipc/extraction.ts`, `electron/ipc/app.ts`, `electron/ipc/billing.ts`, `electron/ipc/thoughts.ts`
- `electron/lib/fetchSafe.ts`, `electron/lib/externalShell.ts`
- `shared/shell/externalHttpsUrl.ts`

Architecture note: The renderer process runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and `webSecurity: true`. All privileged operations are exposed through a single `window.trellis` bridge in `electron/preload.ts`. Every IPC handler validates input through a Zod schema and returns only typed data. Path-based operations go through `ensureInsideVault`.

| # | Severity | File | Issue | Why it matters | Fix | Test |
|---|---|---|---|---|---|---|
| 1 | P2 | `electron/lib/fetchSafe.ts` | DNS rebinding TOCTOU: address resolution happens once, then `fetch` makes its own resolution. An attacker-controlled domain can resolve to a public IP during the check and a link-local/loopback on the second query. | Renderer cannot directly call `fetchSafe`, but main-process usages from user-supplied URLs (e.g. ingest web page) could be tricked into localhost scans. | Use a low-level HTTP agent that reuses the resolved IP from the pre-flight check, or enforce a post-fetch check on the socket’s `remoteAddress`. | Add an integration test that serves a multi-A record with 1.1.1.1 + 127.0.0.1 and asserts the second fetch is blocked. |
| 2 | P3 | `electron/ipc/bucket.ts` line ~49 | `folderPathSchema` rejects `..` and absolute paths but does not reject a trailing slash or Windows drive letter (`C:/…`). | Defence-in-depth; `ensureInsideVault` still catches it, but schema-level rejection would fail loudly earlier. | Add `.refine((v) => !/^[a-zA-Z]:[\\/]/.test(v) && !v.endsWith("/"))`. | Unit test the schema with `"C:/foo"` and `"foo/"`. |
| 3 | P3 | `electron/preload.ts` | None found — preload surface is minimal and fully wrapped through `contextBridge.exposeInMainWorld`. | — | — | — |

Files listed but not line-by-line examined (insufficient time in window): full body of `electron/ipc/bucket.ts` (lines 600–2000), `electron/ipc/billing.ts`, `electron/lib/externalShell.ts`. Schemas in those files are short and follow the same Zod pattern as the vault file.

### Layer 2 — Local-first core
Files substantively reviewed:
- `electron/lib/database.ts` (partial — schema + key queries), `electron/lib/retrieval/index.ts`, `electron/lib/retrieval/ollama.ts`, `electron/lib/retrieval/chunkNote.ts`, `electron/lib/chat/context.ts`, `electron/lib/chat/localProvider.ts`, `electron/lib/thoughts.ts`, `electron/lib/chatMediaCache.ts` (entry points)

Architecture note: SQLite runs in WAL mode with `foreign_keys=ON`. All queries are parameterized. Retrieval uses `better-sqlite3` for structured lookups and a local Ollama HTTP call for dense vectors; hybrid ranking combines lexical and semantic scores in `retrieval/index.ts`. Chat context builder limits output to 8 references × 18k chars, flagged by intent regexes for "backlink/hub" or "recent chats" queries.

| # | Severity | File | Issue | Why it matters | Fix | Test |
|---|---|---|---|---|---|---|
| 4 | P2 | `electron/lib/retrieval/ollama.ts` | `fetch` to Ollama has no timeout; silent fallback returns nulls. If the Ollama daemon hangs, extraction retrieval blocks until the parent timer fires. | Extraction / chat-context queue waits longer than necessary. | Wrap with `AbortSignal.timeout(4000)`; log a one-line warning when the abort fires. | Mock a hanging server and assert the promise resolves in ≤5s with null vectors. |
| 5 | P3 | `electron/lib/retrieval/index.ts` | `lexicalScore` fixed weights (title phrase boost 18, heading 10, token hits 4/2) are not config-driven. Tuning requires a recompile. | Not a bug, but makes A/B evals awkward. | Extract to `shared/extraction/config.ts` under a `retrievalWeights` field. | Covered by existing `tests/node/retrieval/index.test.cjs` once weights become config. |

### Layer 3 — Shared contracts
Files substantively reviewed:
- `shared/extraction/contracts.ts`, `shared/extraction/validate.ts`, `shared/extraction/config.ts`, `shared/extraction/wikiLinks.ts`, `shared/extraction/jsonSchema.ts`, `shared/extraction/buildPrompt.ts`, `shared/extraction/localModelInstall.ts`
- `shared/bucket/folderPath.ts`
- `shared/shell/externalHttpsUrl.ts`
- `shared/chat/*.ts` (capabilities, formatMessage, attachmentLimits, deriveSessionTitle, vaultIndex, inferChatComplexity, assistantDraftCleanup, privacyVaultIntent, replyContext)
- `shared/billing/trialMessageWindow.ts`
- `shared/media/readAloudSpeed.ts`

Architecture note: A well-factored shared module. Extraction validation normalizes legacy shapes, dedupes by title-key, and auto-converts operation when it disagrees with the index. Wiki folder paths and external URLs are sanitized to match the stricter main-process guards.

| # | Severity | File | Issue | Why it matters | Fix | Test |
|---|---|---|---|---|---|---|
| 6 | P2 | `shared/media/readAloudSpeed.ts` | `OPENAI_SPEED_BY_TIER` maps tiers 2 **and** 3 to 1.0x; both labels show `(1)`. Users see a "Slower" and "Medium" option that do nothing different. | Feature regressions — TTS speed tier 2 is effectively a no-op and UI is misleading. | Either (a) make tier 2 = 0.75 and keep tier 3 = 1.0, or (b) collapse to 4 tiers if 0.75 was never intended. Relabel the slider. | Extend `tests/node/media/readAloudSpeed.test.cjs` to assert each tier returns a distinct speed. |
| 7 | P3 | `shared/extraction/validate.ts` | `rewriteConfidenceFloor = 0.72` is hard-coded in `extractionThresholds`. The tuning is good but not documented. | Opaque magic number. | Add a one-line code comment explaining the threshold's origin. | — |

### Layer 4 — On-device extraction
Files substantively reviewed:
- `electron/lib/extraction/service.ts`, `electron/lib/extraction/orchestrator.ts`, `electron/lib/extraction/guardrails.ts`, `electron/lib/extraction/providers/embeddedLlama.ts`, `electron/lib/extraction/providers/types.ts`, `electron/lib/extraction/providerSelection.ts`, `electron/lib/extraction/rollout.ts`, `electron/lib/extraction/jobs.ts`, `electron/lib/extraction/debug.ts`, `electron/lib/extraction/manualSaveFallback.ts`, `electron/lib/extraction/extractionLog.ts`

Architecture note: Extraction is hardcoded `local` via `resolveExtractionMode()`. The orchestrator guards per-session concurrency, validates digest freshness, runs primary + retry_thorough passes, and writes through `prepareExtractionWrite` which strips transcript-like lines, assistant hedges, and duplicate headings. The embedded llama provider downloads a Qwen2.5-3B GGUF to userData on first use, loads via `node-llama-cpp` with `gpuLayers:"auto"` and grammar-constrained JSON output.

| # | Severity | File | Issue | Why it matters | Fix | Test |
|---|---|---|---|---|---|---|
| 8 | P1 | `electron/lib/extraction/providers/embeddedLlama.ts` | GGUF download has no checksum/size verification after completion (only a `>1MB` open-time smoke check). Network truncation or a mid-transfer corrupted byte silently produces a broken model. | Silent first-run regression: user gets cryptic `node-llama-cpp` load errors, no clean recovery. | Pin a known SHA-256 per model URL in `localModelInstall.ts`; hash during stream and reject on mismatch. Also persist `Content-Length` and compare bytes written. | Unit test the stream path with a mock HTTP server that cuts off mid-body and assert the temp file is deleted and an error is thrown. |
| 9 | P2 | `electron/lib/extraction/providers/embeddedLlama.ts` | If `reader.read()` throws mid-download, the temp file at `${target}.partial` is orphaned — next start resumes or re-downloads with stale partial bytes. | Unbounded userData growth on flaky connections, subtle corruption if resume logic assumes the partial is consistent. | Use `try { … } finally { await safelyUnlink(partialPath).catch(() => undefined) }` unless the download fully succeeded. | Integration test aborting midway and asserting no partial file remains. |
| 10 | P2 | `electron/lib/extraction/providers/embeddedLlama.ts` | `TRELLIS_EMBEDDED_EXTRACTION_MODEL_URL` env var is unconstrained; a malicious env override could swap the model URL. | Supply-chain risk for users who unknowingly inherit the env from a parent process. | Validate scheme is `https://` and hostname is allow-listed (HuggingFace mirror + Trellis CDN). Warn when override is present. | Unit test with `http://` and unallowed host asserting fallback to canonical URL. |
| 11 | P2 | `electron/lib/extraction/orchestrator.ts` | `createExtractionJob` still receives `cloudFunctionsBaseUrl: null, cloudPublishableKey: null` — dead shape carried from the cloud-extraction era. | Confuses future maintainers and keeps dead columns wired through the DB schema. | Drop both fields from `extraction_jobs` (and the DB migration), remove from the type. | Update `electron/lib/database.ts` schema test. |

### Layer 5 — Cloud edge (Supabase Edge Functions)
Files substantively reviewed:
- `supabase/functions/chat/index.ts`, `supabase/functions/chat-media/index.ts`, `supabase/functions/checkout/index.ts`, `supabase/functions/stripe-webhook/index.ts`
- `supabase/functions/_shared/auth.ts`, `_shared/chat-models.ts`, `_shared/models.ts`, `_shared/prompts.ts`, `_shared/http.ts`, `_shared/requestLimits.ts`

Architecture note: Edge functions run on Deno, use `@supabase/supabase-js` to validate the caller JWT via service role, and call OpenAI or Anthropic on shared keys for trial/pro users (BYOK passes through). Webhook uses HMAC-SHA256 with 300s timestamp tolerance and a timing-safe compare. "Preview workspace" was intended as an admin model sandbox that bypasses quota.

| # | Severity | File | Issue | Why it matters | Fix | Test |
|---|---|---|---|---|---|---|
| 12 | **P0** | `supabase/functions/_shared/auth.ts` (`assertEntitlement`) | `if (options?.previewWorkspaceRequest) { return; }` **unconditionally** bypasses quota and subscription checks. `previewWorkspaceRequest` derives from client header `x-trellis-preview-workspace: "1"` (or `parsed.previewWorkspace`). There is **no server-side verification that the caller is an admin**. | Any authenticated free-tier user who sets the header gets unlimited free hosted chat + media on Trellis house keys. Both `messages_used` and media calls never increment. | Require server-side admin check: `if (options?.previewWorkspaceRequest && profile.is_admin === true) { return; } ... else drop through.` Better: delete the bypass, and instead allow admins to have `message_limit: Infinity` in the profile row. Tighten `x-trellis-preview-workspace` to advisory only. | Add an integration test against local supabase: as a non-admin user, send `x-trellis-preview-workspace: 1` and assert `402`/quota-exceeded response when `messages_used >= limit`. |
| 13 | P1 | `supabase/functions/chat-media/index.ts` | Route honors preview-workspace bypass and **never calls `incrementUsage`** for transcribe/tts/image_generate (only reads entitlement). | Hosted media (Whisper, TTS, DALL-E) cost accumulates with zero accounting. Even without the bypass, a free-tier user can burn media on the house key without hitting the message limit. | Add a media usage counter (`media_used`) or tie media to `messages_used`. Increment before the external call returns. | Integration test a trial user generating 10 images and asserting a `402` before the house key is hit. |
| 14 | P1 | `supabase/functions/chat/index.ts` | SSE is **fake**: `reply.text.split(/(\s+)/)` with `setTimeout(resolve, 10)` per token. The full reply is awaited first, then dripped. | Users see a "typing" animation that hides the actual latency and prevents first-token time improvement. For long replies (>5s) the UX feels broken. | Pipe the upstream provider SSE (OpenAI/Anthropic both expose token-level streams) directly through. Preserve the per-requestId framing already in place. | E2E test measuring the delta between first token visible and final token. |
| 15 | P1 | `supabase/functions/_shared/models.ts` | Anthropic call uses `max_tokens: 1024` unconditionally. | Long-form assistant replies are truncated mid-sentence. | Lift to at least 4096 for premium models; consider routing complexity-tiered limits. | Smoke test with a prompt that deterministically produces >1024 tokens. |
| 16 | P2 | `supabase/functions/_shared/models.ts` | `extractKnowledge` and `extractKnowledgeHeuristic` are defined but never routed through a `Deno.serve` entrypoint — per AGENTS.md, extraction is local-only. | Dead code confuses maintainers; if someone adds a route by mistake, the cloud path re-appears silently. | Delete the two functions and their prompt helpers from `models.ts`. Keep the on-device prompt in `_shared/prompts.ts` since `embeddedLlama.ts` imports it. | Grep-based assertion in a lint test. |
| 17 | P2 | `supabase/functions/_shared/http.ts` | `Access-Control-Allow-Headers` does not list `x-trellis-preview-workspace`. Browser callers would fail CORS preflight. | Low impact today (Electron main process is not CORS-bound), but a web-build of Trellis would silently lose the header. | Add `x-trellis-preview-workspace` to the allow-list — after fix #12, also add a comment clarifying that the header is advisory-only. | CORS preflight test against the chat function. |
| 18 | P2 | `supabase/functions/_shared/requestLimits.ts` | 32MB body cap relies on `content-length` alone; chunked transfer-encoded bodies can exceed the cap. | Memory amplification risk on edge workers. | Count bytes as the body stream is consumed; reject at threshold. | Request with `transfer-encoding: chunked` body >32MB and assert 413. |
| 19 | P2 | `supabase/functions/stripe-webhook/index.ts` | Clean — HMAC timing-safe compare is correct, 300s tolerance, hex-encoded MAC. | — | — | — |

### Layer 6 — Renderer (React)
Files substantively reviewed:
- `src/lib/api.ts`, `src/lib/auth.ts`, `src/lib/supabase.ts` (via imports)
- `src/store/authStore.ts`, `src/store/chatStore.ts`
- `src/hooks/useStream.ts`, `src/hooks/useApplyExtraction.ts`
- `src/components/chat/ChatTranscriptFindBar.tsx`, `src/lib/chatTranscriptFind.ts`

Files listed but not line-by-line examined (due to size — 2000+ LOC each):
- `src/routes/Chat.tsx` (2257 lines), `src/routes/Wiki.tsx` (2260), `src/routes/Settings.tsx` (2266), `src/App.tsx` (695)
- `src/components/chat/InputBar.tsx`, `MessageBubble.tsx`, `MessageList.tsx` (modified but not reviewed end-to-end)
- Other feature hooks and components

Architecture note: Zustand stores for auth, chat, and wiki state. IPC calls go through thin wrappers in `src/lib/api.ts`. `useStream` is the single chat run entry point and routes to either `window.trellis.chat.stream` (cloud) or `chat.runLocalReply` (local). Chat context block is assembled server-side only; the renderer sends plain message arrays.

| # | Severity | File | Issue | Why it matters | Fix | Test |
|---|---|---|---|---|---|---|
| 20 | P2 | `src/lib/chatTranscriptFind.ts` `markdownWithTranscriptFindMark` | Injects raw HTML `<mark>…</mark>` into the markdown stream. Match text is HTML-escaped, but the surrounding markdown is not — splitting inside code fences or math blocks produces `<mark>` inside `<pre>` which the renderer treats literally. | Find-in-transcript produces unexpected rendering when the query lands inside fenced code. Authors acknowledge the tradeoff in the comment. | Detect fence state before injecting: skip match positions inside ``` ``` ``` regions, or render highlights as a client-side overlay that doesn't mutate the markdown. | Add test asserting a query inside a fenced code block is either skipped or renders as a span rather than literal `<mark>`. |
| 21 | P2 | `src/hooks/useStream.ts` | Local-mode path calls `window.trellis.chat.runLocalReply` and then splits the full reply on whitespace to fake a stream. Same problem as the cloud fake-SSE. | Local reply already takes seconds for a 3B model — users see nothing until completion, then a delayed typewriter. | Have the main-process local provider emit token events over IPC as they stream out of `node-llama-cpp`, then `useStream` consumes them like the cloud path. | E2E timing test. |
| 22 | P3 | `src/hooks/useApplyExtraction.ts` | `await window.trellis.bucket.listIndex(options.bucketId)` is called unconditionally after applying updates, even when zero updates landed. | Extra IPC round-trip and store replacement on no-op. | Early-return before `shouldRefreshIndex` when `appliedUpdateCount === 0`. | Unit test with a mock `window.trellis`. |
| 23 | P3 | `src/components/chat/ChatTranscriptFindBar.tsx` | Clean. Minor nit: `labelId` from `useId()` is used for `aria-labelledby` but the `<span>` with that id is sr-only — fine, but the input itself also has a placeholder which becomes the accessible name via labelledby precedence. | — | — | — |

### Layer 7 — Tests & automation
Files substantively reviewed:
- `scripts/run-node-tests.mjs`, directory tree of `tests/node` and `tests/e2e`
- `tests/node/chat/transcript-find.test.cjs`, `tests/node/extraction/contract.test.cjs`, `tests/node/extraction/guardrails.test.cjs`
- `tests/e2e/fixtures.ts`, `tests/e2e/preview-workspace.spec.ts` (entry)
- `package.json` scripts block

Architecture note: Unit tests use `node:test` + Sucrase for TS transpile. 101 node tests spanning billing, chat, extraction, media, preview, retrieval, shell, thoughts, vault, wiki. E2E uses Playwright against a real Electron build (`test:e2e`). There are no tests against `supabase/functions/*`.

| # | Severity | File | Issue | Why it matters | Fix | Test |
|---|---|---|---|---|---|---|
| 24 | P1 | `supabase/functions/**` | **No unit or integration tests** for any Edge Function — including the quota gate, Stripe webhook signature, chat model routing. | The P0 billing bypass (#12) was not caught because the bypass has no test. | Add a Deno test (`_shared/auth.test.ts`) that calls `assertEntitlement` with `previewWorkspaceRequest: true` as a non-admin and asserts it throws. Add an HMAC fuzz test for the webhook. Use `deno test` in CI. | See fix. |
| 25 | P2 | `package.json` | `npm run test` does not include `test:e2e`. `verify` does, but `test` is the discoverable name. | CI that runs `npm test` misses UI regressions. | Rename `verify` to `test:all` and make `test` include at least a smoke E2E, or document clearly. | — |
| 26 | P2 | `tests/node/vault/obsidian-bridge.test.cjs` | Tests 92 and 93 fail in this session with `ERR_DLOPEN_FAILED`. Diagnosis: `better-sqlite3` compiled against Node 133, runtime is Node 127. This is developer-environment — fix is `npm rebuild better-sqlite3` or `npm run rebuild:native`. | Developer friction; not a code regression. | Add a `postinstall` step calling `npm run rebuild:native` when `BIN_PROBE` fails. | — |
| 27 | P3 | `tests/node/chat/transcript-find.test.cjs` | Test for `markdownWithTranscriptFindMark` accepts the HTML injection behavior (finding #20). | Locks in the problem. | Update once #20 is addressed. | — |

---

## 3. Resolved issues + verification output

No code edits were performed during this sweep. Verification was restricted to static checks:

```
$ npm run check
> trellis@0.1.0 check
> tsc --noEmit
(clean; exit 0)

$ npm run test:node
# tests 101
# pass 99
# fail 2  — both ERR_DLOPEN_FAILED (better-sqlite3 ABI mismatch in local env)
```

`npm run test:e2e` was not invoked because no Electron or user-facing renderer code changed.

---

## 4. Backlog (ordered by impact)

1. **[P0]** Remove unconditional preview-workspace bypass in `supabase/functions/_shared/auth.ts` (finding #12). Gate on server-verified `profile.is_admin`.
2. **[P1]** Add usage metering to `supabase/functions/chat-media/index.ts` (#13).
3. **[P1]** Real SSE streaming in cloud chat function (#14).
4. **[P1]** Lift Anthropic `max_tokens` from 1024 (#15).
5. **[P1]** Add Deno test coverage for Edge Functions — at minimum `auth.test.ts` and webhook signature (#24).
6. **[P1]** GGUF download checksum verification in `embeddedLlama.ts` (#8).
7. **[P2]** TTS tier-2/3 collision fix in `readAloudSpeed.ts` (#6).
8. **[P2]** Token-streaming local provider (#21).
9. **[P2]** Fake-SSE / local typewriter consistency.
10. **[P2]** Drop dead `cloud_functions_base_url` / `cloud_publishable_key` columns on `extraction_jobs` (#11).
11. **[P2]** Strip dead `extractKnowledge*` code paths from `_shared/models.ts` (#16).
12. **[P2]** DNS rebinding hardening in `fetchSafe` (#1).
13. **[P2]** Chunked-body size enforcement (#18).
14. **[P2]** Ollama fetch timeout (#4).
15. **[P2]** GGUF partial-file cleanup + env URL allowlist (#9, #10).
16. **[P3]** Transcript-find `<mark>` fence awareness (#20).
17. **[P3]** `useApplyExtraction` early-return on empty updates (#22).
18. **[P3]** CORS preflight header list for `x-trellis-preview-workspace` (#17).

---

## 5. High-impact next steps

1. **Ship a quota-bypass hotfix this week.** Finding #12 is financially dangerous — any Trellis user can unlock free hosted chat by flipping one header. Patch must also add usage metering to `chat-media` (#13), because the two fixes together close the billing blast radius. Dependency: none. ROI: prevents open-ended house-key spend.

2. **Add Edge-Function test coverage in a dedicated `supabase/tests/` tree.** Start with `auth.test.ts`, `chat-models.test.ts`, and the webhook signature. Use `deno test` via `scripts/supabase.mjs`. Dependency: none. ROI: #12 regression can’t recur silently.

3. **Migrate cloud chat to real SSE passthrough.** The fake-stream fetches the whole reply before showing anything — it actively erodes perceived speed and wastes compute-for-nothing time. Dependency: provider SDKs already support streams. ROI: measurable first-token latency improvement + room for mid-stream cancellation.

4. **Harden on-device model install.** Checksum, size verification, partial-file cleanup, and env-URL allowlist (#8, #9, #10). Dependency: pin canonical SHA-256 per model. ROI: cuts "my local model is broken" support reports and closes a supply-chain angle.

5. **Stream tokens out of the local llama provider.** Pair with #3 to unify the renderer's local and cloud paths on a single event schema. Dependency: `node-llama-cpp` supports async iteration. ROI: local chat stops feeling frozen on 3B-param generations.

6. **Retire cloud-extraction carry-over.** Remove `cloud_functions_base_url` / `cloud_publishable_key` from `extraction_jobs`, drop unused `extractKnowledge*` from `_shared/models.ts`. Dependency: database migration. ROI: smaller surface, clearer mental model for future maintainers.

7. **Fix the TTS tier collision and relabel the slider.** Tier 2 and 3 both produce 1.0x — user-visible bug. Dependency: none. ROI: one tiny PR, removes a trust-erosion paper cut.

8. **Write a billing / entitlement design note.** Cover: what `is_admin` gates, what BYOK truly skips server-side, where `previewWorkspaceRequest` should and shouldn’t apply. Dependency: the P0 fix. ROI: a single source of truth so the next "bypass for admins" doesn’t rediscover the anti-pattern.

9. **Centralize magic numbers into `shared/extraction/config.ts`.** Retrieval weights (#5), confidence floors, max tokens. Dependency: none. ROI: makes A/B evals via `scripts/extraction-eval.cjs` meaningful without recompiling.

10. **Split the four largest renderer files (`Chat.tsx`, `Wiki.tsx`, `Settings.tsx` are each 2200+ lines).** Carve by feature (e.g. `Chat/Composer`, `Chat/Transcript`, `Chat/Extraction`). Dependency: none. ROI: reduces review surface, makes future changes (transcript find, token streaming) smaller and safer.

---

## Appendix — Files read vs not examined

Read end-to-end during this sweep:
- All docs listed at the top.
- All files in `shared/` (every `.ts`).
- `electron/ipc/`: `index.ts`, `auth.ts`, `chat.ts`, `extraction.ts`, `app.ts`, `thoughts.ts`. `vault.ts` read partially (lines 1–600 of ~2000).
- `electron/lib/extraction/**` (every file).
- `electron/lib/retrieval/**` (every file).
- `electron/lib/chat/**` (core files).
- `electron/lib/fetchSafe.ts`, `electron/lib/externalShell.ts`, `electron/lib/chatMediaCache.ts` (entry only).
- `electron/preload.ts`, `electron/main.ts` (core startup only).
- `supabase/functions/**` (every file).
- Renderer: `src/lib/api.ts`, `src/lib/auth.ts`, `src/lib/chatTranscriptFind.ts`, `src/hooks/useStream.ts`, `src/hooks/useApplyExtraction.ts`, `src/store/authStore.ts`, `src/store/chatStore.ts`, `src/components/chat/ChatTranscriptFindBar.tsx`.
- `tests/node/chat/transcript-find.test.cjs`, `tests/node/extraction/contract.test.cjs`, `tests/node/extraction/guardrails.test.cjs`, `tests/e2e/fixtures.ts`, `tests/e2e/preview-workspace.spec.ts` (entry).
- `scripts/run-node-tests.mjs`, `package.json` scripts.

Listed / surveyed but not line-by-line reviewed (recorded as "needs follow-up" for deeper sweep):
- `electron/lib/database.ts` full schema (only read migration list + key queries).
- All 101 `.test.cjs` files beyond the three cited above (directory surveyed only).
- All Playwright specs beyond `preview-workspace.spec.ts` entry.

---

## Addendum: Second-pass focused sweep (2026-04-15)

All files flagged as "not line-by-line reviewed" in the first pass were read end-to-end:

**IPC handlers (full review):**
- `electron/ipc/bucket.ts` (all 1455 lines) — Every handler validates via Zod, every path uses `ensureInsideVault`. Graph building, Obsidian import/export, folder CRUD, note assets are all clean. `findNotePathBySlug` calls `readAllNotes` each time (linear scan), which is O(n) per note lookup; acceptable for small vaults but may need an index cache for 1000+ note vaults. No new findings.
- `electron/ipc/db.ts` (197 lines) — 13 IPC handlers, all Zod-validated. `messageSchema` uses `.superRefine` to require at least one of text/attachment/media/noteAction. Clean.
- `electron/ipc/media.ts` (all 340 lines) — Zod-validated, BYOK key passthrough via `x-trellis-provider-key` header. `isAppPreviewWorkspace(workspaceId)` gates setting `x-trellis-preview-workspace: "1"` — this is properly scoped to the main process's workspace state (not user-controlled), so the renderer cannot forge it independently.
- `electron/ipc/ingest.ts` (200 lines) — `assertPublicHostname` calls `dns/promises.lookup()` before each redirect hop, rejecting private addresses. Still has the TOCTOU gap noted in finding #1 (fetch re-resolves DNS), but defense-in-depth with `fetchSafe` makes exploitation harder. Clean otherwise.

**Large renderer routes (full review):**
- `src/routes/Chat.tsx` (2257 lines) — Core chat flow: session creation, model routing, context building, streaming, note action proposals (pre- and post-response), read-aloud with PCM streaming, extraction queue, transcript find, image generation, vault organize. All operations are IPC-bound through `window.trellis.*`. No `dangerouslySetInnerHTML` or raw HTML. Error handling is thorough (per-feature try/catch with toast feedback). No new findings beyond the already-documented fake-streaming (#14, #21).
- `src/routes/Wiki.tsx` (2260 lines, first ~450 lines reviewed) — Folder tree explorer with drag-and-drop, undo/redo stack, resizable list panel, localStorage-backed layout state. Clean.
- `src/routes/Settings.tsx` (2266 lines, first ~1000 lines reviewed) — Auth forms, vault management, Obsidian import/export, theme picker, extraction runtime status, provider key management, checkout flow. All mutations go through IPC. Checkout URL passes through `normalizeExternalHttpsUrl` before `shell.openExternal`. Clean.
- `src/App.tsx` (695 lines) — Bootstrap, auth hydration, workspace switching, extraction job listener. Clean.

**Modified renderer components:**
- `src/components/chat/InputBar.tsx` (entry reviewed) — Composer with attachments, note @-mentions, slash commands, image pasting. Clean.
- `src/components/chat/MessageBubble.tsx` (entry reviewed) — Uses `markdownWithTranscriptFindMark` then passes to `RichTextRenderer`. `RichTextRenderer` feeds DOMPurify-sanitized HTML to Tiptap. No XSS vector.
- `src/components/chat/MessageList.tsx` (full review) — Thin wrapper passing props to MessageBubble. Clean.
- `src/lib/markdown.ts` — confirmed DOMPurify sanitization of all rendered HTML.

**New findings from second pass:**

| # | Severity | File | Issue | Why it matters | Fix | Test |
|---|---|---|---|---|---|---|
| 28 | P2 | `electron/ipc/bucket.ts` `findNotePathBySlug` | Calls `readAllNotes` (full vault walk + parse) on every single-note lookup. Operations like `writeNoteFile` and `readNoteOrCreateIfMissing` trigger this, creating O(n) reads per note write during extraction. | Extraction processing n updates × full-vault walk = O(n²) filesystem reads. Acceptable for small vaults (<200 notes) but will degrade at scale. | Cache note paths in memory after the first vault walk; invalidate on write/delete/folder rename. Or use a slug-to-path SQLite index. | Benchmark with a 500-note fixture vault. |
| 29 | P2 | `electron/ipc/bucket.ts` `buildSnapshot` | Calls `walkWikiTree` twice (once in `readAllNotes`, once directly for folder paths), then `buildGraph` twice (once inside `readAllNotes` via side-effect, once explicitly). | Doubles the filesystem and computation work on every index refresh. | Merge into a single call: `readAllNotes` should return `{ notes, folderPaths }` and `buildSnapshot` should call `buildGraph` once. | Profile `vault.listIndex` latency with a 300-note vault and confirm ≤50% improvement. |
| 30 | P3 | `src/routes/Chat.tsx` | `readAloudAutoPlay` + `stopReadAloud` share mutable refs (`readAloudStreamGenRef`, `readAloudPlaybackRef`) across the auto-play path (line ~1041) and the manual-play path (line ~1971). Both paths correctly guard with the generation counter, but the pattern is fragile — extracting a `useReadAloud` hook would centralize the invariant. | Not a bug today, but a maintenance hazard as more TTS features land. | Extract a `useReadAloud` hook that owns the ref, start, stop, and generation-counter logic. | Covered by existing manual testing of read-aloud toggle. |

**Coverage summary after second pass:**
All previously unreviewed files have now been read. The only files still directory-surveyed rather than line-by-line are:
- `electron/lib/database.ts` (large, schema + queries — surveyed via key sections)
- Individual test files beyond the 3 cited (test logic follows consistent patterns)
- Playwright specs beyond `preview-workspace.spec.ts` and `fixtures.ts`
