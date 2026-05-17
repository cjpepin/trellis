# Extraction routing: cloud vs on-device

This document matches the product direction in [cloud-extraction-plan.md](cloud-extraction-plan.md) and complements [extraction-v2.md](extraction-v2.md).

## Which model runs

1. **Cloud-backed chat (Supabase sessions):** the `chat-session-extract` Edge Function runs the same **cheap cloud extraction models** (`cloudExtractionModels` in `shared/extraction/config.ts`) using the user’s **BYOK** key from `provider_credentials`. The function returns structured JSON; the renderer applies writes via `useApplyExtraction` (shared guardrails). This path does not use `TRELLIS_FEATURE_CLOUD_EXTRACTION` in Electron; that flag still applies to **desktop-orchestrated** cloud extraction when local SQLite is canonical.

2. **Desktop cloud extraction (legacy flag):** when `TRELLIS_FEATURE_CLOUD_EXTRACTION=1`, the Electron orchestrator can prefer **cheap cloud models** using the user’s **BYOK** API key from Settings for sessions that are still stored locally. That path is the main way to reach strong **create / append / rewrite** judgment on long threads **before** full cloud cutover.

3. **Local-only chat** (e.g. privacy mode or models that are not cloud-backed): extraction uses the **on-device** GGUF via `node-llama-cpp` (`embedded` provider). No transcript is sent to third-party APIs for that path.

4. **Fallback** (desktop orchestrator): if cloud extraction is unavailable (missing key, rate limit, HTTP errors, offline), the app **falls back** to the same on-device model so something can still run.

The embedded stack is **not** expected to match cloud quality on difficult merges; it exists for **local-first**, **offline**, and **resilience**.

## Environment flags

| Variable | Default | Role |
|----------|---------|--------|
| `TRELLIS_FEATURE_CLOUD_EXTRACTION` | off (`0`) | When enabled, the **Electron** orchestrator tries hosted extraction first for **locally stored** chat sessions (see item 2 above). Supabase-only sessions use `chat-session-extract` regardless. |
| `TRELLIS_FEATURE_LOCAL_EXTRACTION` | on (`1`) | When off, disables on-device note processing entirely (no cloud fallback path for local extraction). |

See `.env.example` and `AGENTS.md` for full env documentation.

## Profiling latency and quality

To see **where time goes**, use **Settings → Developer / Extraction debug runs** (when exposed) or main-process logs tagged `processJob.*` and `logExtraction`. Each completed job records:

- **Prep** (`prepDurationMs`): vault snapshot, retrieval (including optional Ollama embed when embeddings exist), enriching related notes, reading prior session notes.
- **First LLM** (`llmPrimaryDurationMs`): wall time for the first extraction strategy call (cloud and/or embedded attempts are detailed in `attemptedProviders`).
- **Retry pass** (`llmRetryThoroughDurationMs`): optional second pass when the first pass returned only `noop` updates (see below).

**Scenarios worth comparing:**

- **Cloud path**: enable `TRELLIS_FEATURE_CLOUD_EXTRACTION`, set API keys, use a GPT or Claude chat model. Expect prep + one cloud round-trip; no second “retry thorough” pass when the winning provider is cloud.
- **Local-only**: disable cloud flag or use a session model that maps to local-only; expect embedded timing and possible retry pass.
- **Fallback**: cloud enabled but invalid key or airplane mode; expect cloud attempt failure then embedded (wall time can **add** both attempts).
- **Retrieval**: large vault with `note_embeddings` populated — ensure `ollama serve` is up if you rely on semantic scores; otherwise retrieval degrades to lexical-only after a short timeout. After embedding hits are chosen, the main process **merges lexical matches** (`electron/lib/extraction/relatedNotesLexical.ts`) between the retrieval query and note titles/slugs/tags so a secondary topic (e.g. a second schedule mentioned in the same chat) can still appear in “Relevant Existing Notes” for multi-note updates.

## Manual / idle chat capture fallbacks

When the curator returns **no applied wiki writes**, Trellis may synthesize a capture note (`manualSaveFallback.ts`). The model’s **`sessionTitle`** (for example `"Brief Chat"` for empty extractions) is a **chat list label**, not a vault note name. Fallback resolution **does not** use those generic session placeholders as the **note title**; it prefers a non-placeholder suggested title, then the user’s session title, then transcript-derived wording, then a dated label—see `resolveFallbackTargetTitle`.

## Retry thorough (second pass)

When the first model pass returns **no durable updates** (`noop` only), the orchestrator may run a **second** pass with stronger instructions. **Cloud** winners skip this second pass to avoid doubled API cost and latency; **embedded** still runs it for idle / session-switch / manual triggers, since the small local model benefits from the extra nudge.
