# Web parity checklist

Tracks gaps between the **Electron** client (full `window.trellis` IPC) and the **browser SPA** (`!hasElectronPreloadBridge()`), plus platform follow-ups. Update this file when a gap is closed or scope changes.

## Legend

- **Blocking** — core flow fails or is unsafe in the browser without a workaround.
- **High** — major feature missing or severely degraded.
- **Medium** — partial UX or power-user gap.
- **Low** — polish, shell integration, or desktop-only by intent.

## Progress (this repo)

| Item | Status |
|------|--------|
| Cloud chat streaming via Edge `chat` (SSE) in the renderer | Done (`src/lib/webCloudChatStream.ts`, `src/lib/api.ts`) |
| Reject local-only (`privacyMode === "local"`) chat on web (no embedded model) | Done (`streamLocalChat` in `src/lib/api.ts`) |
| Wiki `activeBucketId` without `window.trellis.app.getSettings` | Done (`Wiki` prop from `App.tsx`) |
| Stripe checkout from browser (Edge `checkout` + `window.open`) | Done (`TrellisApiClient.createCheckoutSession`, `Settings.tsx`) |
| Strands / graph / sessions / prefs / BYOK via Supabase | Done (existing cloud layer) |
| Chat context retrieval (`chat-retrieval`) when cloud-backed | Done |
| Realtime refresh for `notes` / `note_links` | Done (`useCloudBucketRealtimeSync`) |
| Strand revision history (cloud) | Done (`note-revisions` + UI branch) |
| Pre-response **note actions** (cloud) | Done (`chat-note-actions`, `proposeChatNoteActionsBridged`, `Chat.tsx`) |
| Post-reply **memory** (cloud) | Done (`chat-memory-turn`, `storeChatTurnMemoryBridged`) |
| **Vault organize** from chat (cloud) | Done (`chat-bucket-organize`, `applyBucketOrganizeBridged`) |
| **Thoughts** route (cloud list / capture / detail / save-as-Strand) | Done (`src/lib/cloud/thoughts.ts`, Supabase RLS; realtime `thoughts` in `useCloudBucketRealtimeSync`) |
| Composer **attachments** (browser) | Done (hidden file + image inputs, in-memory image cache, `clipPublicUrlBridged` + Edge `public-page-fetch` + Readability; PDF text via `pdfjs-dist` in `extractPdfTextInBrowser.ts`) |
| **Read-aloud** + **voice** (browser) | Done (`chat-media` HTTP: `synthesizeSpeechStreamBridged`, `transcribeAudioBridged`, `cancelChatMediaSpeechStream` in `src/lib/cloud/chatMediaBridge.ts`) |
| **Thoughts** enrichment (cloud) | Done (Edge `thought-enrich`, lexical Strands + related captures; `createThoughtBridged` queues enrich; retry in `Thoughts.tsx`) |
| **Wiki note images** (browser) | Done (`uploadWikiNoteImage`, `.trellis-cloud-asset/` + signed URLs in `resolveRenderedNoteImages`) |
| **Graph** (thoughts + enrichment) | Done (`mergeThoughtsIntoGraph`: backing Strand + related-thought edges; `Graph` hydrates `thoughtStore` on mount) |
| **Shell** (web) | Done (`openExternalBridged` / `openPathBridged` in wiki renderers, Settings checkout, vault folder actions) |

## Blocking / high priority (remaining)

| Priority | Area | Gap |
|----------|------|-----|
| Medium | Composer **PDF** attach | Done (`readComposerAttachmentFile` + PDF.js worker chunk; same size cap as desktop `maxChatPickPdfBytes`). |
| Medium | **Attached source → Strands** (ingest extraction) | Done (`composer-source-extract` Edge + `runComposerSourceExtraction` / `flushComposerSourceIngest` on cloud). |
| Medium | **Note images** in wiki | Done (browser: upload to `note-assets` + `.trellis-cloud-asset/…` in markdown; signed URLs in `resolveRenderedNoteImages`; Electron path unchanged). |
| Medium | **Graph** | Done (see Progress). |
| Medium | **Settings** | Vault folder pickers, Obsidian import/export, on-device extraction install, retrieval rebuild, extraction debug — **desktop-only** by design; web uses cloud prefs + Stripe checkout. |
| Low | **Shell** | Done for https links + graceful messaging for folder reveal; no generic `file://` handler on web. |

## Platform / product (not “bugs”)

- **Capacitor / iOS** — planned; same React app with native shell.
- **Semantic / `note_chunks` retrieval** — lexical + DB today; embeddings pipeline separate.
- **Desktop multi-workspace** — non-`personal` Electron workspaces remain local vault/SQLite by design until cutover.

## Verification

After changes: `npm run check`. For risky flows, add or extend Playwright coverage (`npm run test:e2e`), including `tests/e2e/graph-thought-overlay.spec.ts` (Thought → graph search) and `tests/e2e/wiki-https-link.spec.ts` (markdown https links in preview).
