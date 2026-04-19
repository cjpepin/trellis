# Plan: Cloud Extraction Provider + Smarter Rewrite Logic

## Context

Trellis extraction (turning chat conversations into vault notes) currently runs exclusively on a local Qwen2.5-3B model via node-llama-cpp. The 3B model struggles with the judgment-heavy extraction task — titling, deduplication, create vs. append vs. rewrite decisions. For cloud chat sessions, the conversation has already left the device, so routing extraction to a cheap cloud model (GPT-4.1-mini / Haiku 4.5) improves quality dramatically at ~$0.002/session with no new privacy compromise.

Separately, the rewrite-vs-append decision logic is too conservative — `rewriteConfidenceFloor: 0.72` causes too many appends, leading to notes that accumulate sections over time instead of staying cohesive.

### Design Principles

- **No new privacy compromise**: Cloud extraction only applies to sessions that already used a cloud chat model. Local chat stays fully on-device.
- **Cloud provider runs in Electron main process**: Direct API call using the user's existing BYOK key. Not routed through Supabase Edge Functions. Keeps the local-first architecture.
- **Cheap models only**: GPT-4.1-mini and Claude Haiku 4.5 — not the flagship model the user chatted with. ~$0.002/session vs ~$0.15-0.30 for flagship.
- **Automatic fallback**: If cloud extraction fails (bad key, rate limit, offline), falls back to local 3B model.
- **Feature flag defaults OFF**: Opt-in rollout. Existing local-only users completely unaffected.

---

## Change 1: Cloud Extraction Provider

### 1.1 Expand type unions

**`electron/ipc/types.ts` (lines 129-130)**
```ts
ExtractionMode = "local" | "cloud"
ExtractionProviderId = "embedded" | "cloud-openai" | "cloud-anthropic"
```

### 1.2 Add provider-for-model helper

**New file: `shared/chat/providerForModel.ts`**

Simple function usable from both renderer and main process:
```ts
export function providerForChatModel(model: string): "openai" | "anthropic" | null {
  if (model.startsWith("gpt-") || model.startsWith("o1") || model.startsWith("o3")) return "openai";
  if (model.startsWith("claude-")) return "anthropic";
  return null;
}
```

Reason: `src/lib/chatModels.ts` imports from `@electron/ipc/types` which makes it renderer-only. We need a shared utility the main process can also use.

### 1.3 New cloud extraction provider

**New file: `electron/lib/extraction/providers/cloudApi.ts`**

Implements `ExtractionProvider` (interface in `providers/types.ts`):

- **Factory**: `createCloudExtractionProvider(chatProvider: ChatProvider, getApiKey: () => string | null): ExtractionProvider`
- **`getStatus()`**: Available if `getApiKey()` returns a non-null key
- **`extract(input)`**: Direct `fetch` call from Electron main process to:
  - OpenAI: `https://api.openai.com/v1/chat/completions` with model `gpt-4.1-mini`, `response_format: { type: "json_object" }`
  - Anthropic: `https://api.anthropic.com/v1/messages` with model `claude-haiku-4-5`, prefilled assistant `{` to force JSON
- **System prompt**: Same `extractionPrompt` from `supabase/functions/_shared/prompts.ts`
- **User message**: Same `buildExtractionUserMessage(input)` from `shared/extraction/buildPrompt.ts`, but with higher corpus limit (see 1.6)
- **Response parsing**: Same `parseExtractionResponseJson()` from `shared/extraction/validate.ts`
- **Error handling**: Catch 401 (bad key), 429 (rate limit), 5xx (service down). On failure, the service.ts provider loop falls through to embedded provider as fallback.
- **Retry suffix**: Same second-pass retry logic as `embeddedLlama.ts` lines 205-209

### 1.4 Mode resolution

**`electron/lib/extraction/service.ts` (lines 22-24)**

Change `resolveExtractionMode` to accept session model and check feature flag:
```ts
export function resolveExtractionMode(
  sessionModel?: string,
  _mode?: ExtractionMode
): ExtractionMode {
  if (!isCloudExtractionFeatureEnabled()) return "local";
  const provider = sessionModel ? providerForChatModel(sessionModel) : null;
  if (provider) return "cloud";
  return "local";
}
```

### 1.5 Provider registration and ordering

**`electron/lib/extraction/service.ts` (lines 26-36)**

- Change `providers` record type to `Record<string, ExtractionProvider>`
- Add `registerCloudExtractionProviders(deps)` called from `electron/main.ts` during bootstrap
- `buildProviderOrder(mode, chatProvider?)`:
  - `"cloud"` + known provider → `[cloud-{provider}, embedded]` (cloud first, local fallback)
  - `"local"` → `[embedded]` (unchanged)

**`electron/lib/extraction/orchestrator.ts` (line 359)**

Pass `session.model` to `resolveExtractionMode`:
```ts
const jobMode = resolveExtractionMode(session.model, job.mode);
```

The session is already fetched at line 373. Move the mode resolution after the session fetch, or store the session model on the job at queue time.

### 1.6 Raise corpus limit for cloud models

**`shared/extraction/buildPrompt.ts` (line 62)**

Currently `corpus.slice(0, 12_000)` — the 8K context window of the local model forces this. Add an optional parameter:

```ts
export function buildExtractionUserMessage(
  input: ExtractionPromptInput,
  options?: { maxCorpusChars?: number }
): string {
  // ...
  corpus.slice(0, options?.maxCorpusChars ?? 12_000)
}
```

Cloud provider calls with `{ maxCorpusChars: 40_000 }`. Embedded provider unchanged.

### 1.7 Feature flag and config

**`shared/extraction/config.ts`**

Add:
```ts
export const extractionFeatureFlagNames = {
  localExtraction: "TRELLIS_FEATURE_LOCAL_EXTRACTION",
  cloudExtraction: "TRELLIS_FEATURE_CLOUD_EXTRACTION",  // NEW
  heuristicFallback: "TRELLIS_ENABLE_HEURISTIC_EXTRACTION_FALLBACK"
} as const;

export const cloudExtractionModels = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-haiku-4-5"
} as const;
```

**`electron/lib/extraction/rollout.ts`**

Add `isCloudExtractionFeatureEnabled()` — defaults to `false` (opt-in during rollout).

### 1.8 Zod schema updates

**`electron/ipc/extraction.ts`**

Update extraction-related Zod schemas to accept `z.enum(["local", "cloud"])` instead of `z.literal("local")`.

---

## Change 2: Smarter Rewrite Logic

### 2.1 Lower rewrite confidence floor

**`shared/extraction/config.ts` (line 51)**

`rewriteConfidenceFloor: 0.72` → `0.58`

This directly affects `shared/extraction/validate.ts` line 497 which downgrades rewrites below the floor to appends. At 0.58, models that say "rewrite" with moderate confidence will be respected instead of silently converted to append.

### 2.2 Enrich top related notes with full bodies

**`electron/lib/extraction/orchestrator.ts` (after line 500)**

For the top 3 related notes by score, read the full note body and replace the chunk content:

```ts
async function enrichTopRelatedNotes(
  vaultPath: string,
  relatedNotes: ExtractionContextNote[],
  options: { topN: number; maxFullBodyChars: number }
): Promise<ExtractionContextNote[]> {
  const enriched = [...relatedNotes];
  for (let i = 0; i < Math.min(options.topN, enriched.length); i++) {
    const note = enriched[i];
    const fullNote = await readNoteIfExists(vaultPath, note.slug);
    if (fullNote && fullNote.body.length <= options.maxFullBodyChars) {
      enriched[i] = { ...note, content: fullNote.body };
    }
  }
  return enriched;
}
```

Only apply full-body enrichment when `mode === "cloud"` (cloud models have 128K+ context). Local model keeps current truncated chunks to avoid context overflow.

### 2.3 Add staleness signal to related notes

**`shared/extraction/contracts.ts`** — Add optional `updatedAt?: string` to `ExtractionContextNote` (line 44)

**`electron/lib/extraction/orchestrator.ts`** — After enriching related notes, attach `updatedAt` from the vault snapshot:
```ts
const noteUpdatedMap = new Map(snapshot.notes.map(n => [n.slug, n.updated]));
for (const note of enrichedRelatedNotes) {
  note.updatedAt = noteUpdatedMap.get(note.slug);
}
```

**`shared/extraction/buildPrompt.ts` (line 44)** — Include in related notes block:
```
Last updated: ${note.updatedAt ?? "unknown"}
```

### 2.4 Strengthen prompt rewrite bias

**`supabase/functions/_shared/prompts.ts`** — Three targeted edits to the `extractionPrompt`:

1. **Lines 131-132** (decision guidance): Change "choose rewrite when the current transcript and relevant-note excerpt support a cleaner full note" → "choose rewrite when the conversation covers the same core topic as an existing note — merge new information into a cohesive document. Rewrite is the default for same-topic updates."

2. **Lines 204-206** (ACTIONS section): Strengthen rewrite description: "Use this when the note already exists and the conversation revisits, extends, or refines the same topic. This is the preferred operation for returning to an ongoing topic."

3. **Add staleness guidance** near the rewrite instructions: "When a related note shows 'Last updated' more than two weeks ago, strongly prefer rewrite over append."

---

## Files Changed (Summary)

| File | Change |
|------|--------|
| `electron/ipc/types.ts` | Expand `ExtractionMode` and `ExtractionProviderId` unions |
| `shared/chat/providerForModel.ts` | **New** — provider-for-model mapping |
| `electron/lib/extraction/providers/cloudApi.ts` | **New** — cloud extraction provider |
| `electron/lib/extraction/service.ts` | Mode resolution, provider registry, provider ordering |
| `electron/lib/extraction/rollout.ts` | Add `isCloudExtractionFeatureEnabled()` |
| `electron/lib/extraction/orchestrator.ts` | Pass session model, enrich related notes, staleness |
| `electron/ipc/extraction.ts` | Update Zod schemas for cloud mode |
| `electron/main.ts` | Register cloud providers at bootstrap |
| `shared/extraction/config.ts` | Feature flag, cloud models config, lower confidence floor |
| `shared/extraction/contracts.ts` | Add `updatedAt` to `ExtractionContextNote` |
| `shared/extraction/buildPrompt.ts` | Corpus limit parameter, staleness in related notes |
| `supabase/functions/_shared/prompts.ts` | Strengthen rewrite bias, staleness guidance |
| `shared/extraction/validate.ts` | No code change (inherits new threshold from config) |

---

## Verification

1. **`npm run check`** — TypeScript strict mode catches all type changes
2. **`npm run test:node`** — Run full node test suite; specifically:
   - `npm run test:contracts` — extraction validation with new confidence floor
   - `npm run test:guardrails` — extraction write preparation unchanged
3. **New tests to add:**
   - `tests/node/extraction/cloud-provider.test.cjs` — mock fetch, test request formatting for OpenAI and Anthropic, response parsing, error handling, fallback
   - `tests/node/extraction/mode-resolution.test.cjs` — cloud vs local resolution based on session model and feature flag
   - Update existing extraction contract tests if any hardcode the 0.72 threshold
4. **Manual smoke test:** Enable cloud extraction flag, run a cloud chat session, verify extraction routes to cloud provider and produces notes. Disable flag, verify local extraction still works.

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Anthropic JSON reliability (no native `response_format: json`) | Medium | Existing validation strips markdown fences + prefilled `{` approach |
| Rewrite confidence floor reduction (more full-body replacements) | Low | Guardrails layer still runs; vault files on disk are recoverable |
| Full note body in prompt (larger cloud calls) | Low | Capped at 6K chars/note, top 3 only; well within 128K+ context |
| API key access from main process | Low | Already established pattern via `getProviderKey()` in `electron/lib/providerKeys.ts` |

---

## Cost Model

| Approach | Per-session cost | At 20 sessions/day |
|----------|-----------------|---------------------|
| Local Qwen2.5-3B (current) | $0.00 | $0.00 |
| Cloud cheap model (GPT-4.1-mini / Haiku 4.5) | ~$0.002 | ~$0.04 |
| Cloud flagship (GPT-5.4 / Opus) | ~$0.15-0.30 | $3.00-6.00 |

The cheap model path delivers ~85-90% of flagship extraction quality at ~1% of the cost. The 230-line extraction prompt does most of the heavy lifting — the task is structured output + summarization, where cheap models excel.
