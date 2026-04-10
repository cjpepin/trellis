# AGENTS.md — Trellis MVP
> Implementation specification for AI coding agents (Codex, Cursor, Claude Code).
> Read this file in full before writing any code. All decisions made here are binding.

---

## 0. What We're Building

**Trellis** is a local-first AI knowledge desktop app for Windows, Mac, and Linux.

The core loop is simple:
1. User chats with an AI assistant (model routed through Trellis's backend)
2. After each conversation, a background agent extracts entities, claims, and concepts
3. These are compiled into a persistent, interlinked markdown wiki stored on the user's machine
4. The user browses their growing knowledge graph in real time — watching ideas connect

The key insight: **AI conversations should compound, not evaporate.** Every chat makes the knowledge base richer. The wiki is a living artifact, not a chat log.

---

## 1. Stack

| Layer | Technology | Rationale |
|---|---|---|
| Desktop shell | **Electron** (latest stable) | Cross-platform, mature ecosystem |
| Frontend | **React 18 + TypeScript** | Type safety, component reuse |
| Styling | **Tailwind CSS v3** + CSS variables | Utility-first, consistent theming |
| State management | **Zustand** | Lightweight, no boilerplate |
| Local persistence | **SQLite via better-sqlite3** (main process) | Fast, file-based, portable |
| Markdown storage | **Local filesystem** (user-configured vault path) | Files owned by the user, git-compatible |
| Graph visualization | **D3.js force graph** | Full control, no vendor lock |
| PDF parsing | **pdf-parse** | Lightweight, no native deps |
| Web clipping | **Readability.js** (Mozilla) | Same engine as Firefox Reader Mode |
| IPC | Electron contextBridge + typed ipc channels | Secure renderer ↔ main communication |
| Backend API | **Express + TypeScript** (separate Node service, deployed by founder) | Handles auth, billing, model routing |
| Auth | **Clerk** (JWT, social login) | Fast to integrate, handles edge cases |
| Billing | **Stripe** | Subscriptions, usage metering |
| AI routing | **Anthropic SDK + OpenAI SDK** | Claude Sonnet 4 as default, GPT-4o as fallback |

> **No Python. No Rust. No native addons beyond better-sqlite3.** Keep the build simple.

---

## 2. Repository Structure

```
trellis/
├── AGENTS.md                  ← this file
├── package.json
├── electron/
│   ├── main.ts                ← Electron main process entry
│   ├── preload.ts             ← contextBridge definitions
│   ├── ipc/
│   │   ├── vault.ts           ← file system operations
│   │   ├── db.ts              ← SQLite operations
│   │   └── ingest.ts          ← PDF/web clip processing
│   └── lib/
│       └── sqlite.ts          ← DB schema + migrations
├── src/                       ← React renderer
│   ├── main.tsx
│   ├── App.tsx
│   ├── routes/
│   │   ├── Chat.tsx           ← primary chat interface
│   │   ├── Graph.tsx          ← knowledge graph view
│   │   ├── Wiki.tsx           ← markdown note browser
│   │   ├── Ingest.tsx         ← import PDF / web clip
│   │   └── Settings.tsx       ← model, vault, account config
│   ├── components/
│   │   ├── chat/
│   │   │   ├── MessageList.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   ├── InputBar.tsx
│   │   │   └── StreamingIndicator.tsx
│   │   ├── graph/
│   │   │   ├── ForceGraph.tsx
│   │   │   └── NodeTooltip.tsx
│   │   ├── wiki/
│   │   │   ├── NoteViewer.tsx
│   │   │   └── NoteEditor.tsx
│   │   └── shared/
│   │       ├── Sidebar.tsx
│   │       ├── CommandPalette.tsx
│   │       └── Toast.tsx
│   ├── store/
│   │   ├── chatStore.ts
│   │   ├── wikiStore.ts
│   │   └── authStore.ts
│   ├── hooks/
│   │   ├── useStream.ts
│   │   └── useGraph.ts
│   └── lib/
│       ├── api.ts             ← typed fetch client to backend
│       └── markdown.ts        ← parse + render wiki links
├── backend/                   ← Express API (deployed separately)
│   ├── src/
│   │   ├── index.ts
│   │   ├── routes/
│   │   │   ├── chat.ts        ← stream AI responses
│   │   │   ├── extract.ts     ← post-conversation wiki extraction
│   │   │   ├── auth.ts        ← Clerk webhook handlers
│   │   │   └── billing.ts     ← Stripe webhooks + subscription check
│   │   └── lib/
│   │       ├── models.ts      ← model router (Claude / GPT-4o)
│   │       └── prompts.ts     ← all system prompts live here
│   └── package.json
└── docs/
    └── schema.md              ← wiki schema conventions (auto-generated)
```

---

## 3. Coding Standards

### 3.1 General

- **TypeScript strict mode on everywhere.** No `any`. Use `unknown` and narrow it.
- **No inline styles.** Tailwind classes only. One-off values go in `globals.css` as CSS variables.
- **No prop drilling past 2 levels.** Use Zustand stores.
- **All IPC calls must be typed.** Define channel names and payload types in `electron/ipc/types.ts` and import them in both main and renderer.
- **Async/await everywhere.** No raw Promise chains.
- **Error boundaries around every route.** Crashes in one view must not kill the whole app.
- Functions over 40 lines should be split. Name the helpers descriptively.
- Every file exports one primary thing. Barrel exports (`index.ts`) are allowed in `/components`.

### 3.2 File & Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| React components | PascalCase | `MessageBubble.tsx` |
| Hooks | camelCase, `use` prefix | `useStream.ts` |
| Stores | camelCase, `Store` suffix | `chatStore.ts` |
| IPC channels | `kebab:case:verb` | `vault:write:note` |
| DB table names | `snake_case` | `chat_sessions` |
| Wiki files | `kebab-case.md` | `quantum-computing.md` |
| CSS variables | `--trellis-*` prefix | `--trellis-surface` |

### 3.3 IPC Security Rules

- **Never expose Node APIs directly to the renderer.** All main-process capabilities go through `contextBridge` in `preload.ts`.
- Validate all IPC inputs in the main process before acting. Treat renderer input as untrusted.
- File system writes only within the user's configured vault directory. Enforce this with a path prefix check on every write.

### 3.4 State Management

- `chatStore`: active session messages, streaming state, session history list
- `wikiStore`: loaded notes, graph nodes/edges, search index
- `authStore`: user identity (from Clerk JWT), subscription tier, usage counters

Stores must not import from each other. Cross-store logic goes in a hook.

### 3.5 Backend Rules

- Every route validates the Clerk JWT before touching AI providers. Unauthenticated requests return `401` immediately.
- Every route checks subscription status before routing to AI. Expired subscriptions return `402`.
- Streaming responses use `text/event-stream`. The client reads via `ReadableStream`.
- All AI calls are wrapped in try/catch. On provider error, return a structured error event so the client can display a graceful message.
- Log token usage per request to the DB for billing metering. Never log message content server-side.

---

## 4. Design System

### 4.1 Aesthetic Direction

Trellis's visual identity is **"considered dark"** — a refined, serious tool for people who think for a living. Not cold or sterile. Warm dark backgrounds, generous whitespace, quiet typography that gets out of the way, and one accent color that pulses with intent.

Reference mood: a well-worn notebook under a desk lamp. Dense but navigable. Intimate.

### 4.2 Color Palette (CSS Variables)

```css
:root {
  /* Backgrounds */
  --trellis-bg:         #0f0f0f;   /* app background */
  --trellis-surface:    #171717;   /* card / panel surface */
  --trellis-surface-2:  #1f1f1f;   /* elevated surface */
  --trellis-border:     #2a2a2a;   /* subtle borders */

  /* Text */
  --trellis-text:       #e8e3d9;   /* primary text — warm off-white */
  --trellis-text-muted: #7a7570;   /* secondary / metadata */
  --trellis-text-faint: #3d3a36;   /* disabled / placeholder */

  /* Accent */
  --trellis-accent:     #c8a96e;   /* warm amber — the one color that matters */
  --trellis-accent-dim: #8a7248;   /* hover / pressed state */

  /* Semantic */
  --trellis-success:    #5a8a5a;
  --trellis-warning:    #c8a96e;   /* same as accent intentionally */
  --trellis-error:      #a05050;

  /* Graph */
  --trellis-node:       #c8a96e;
  --trellis-node-hover: #e8c88e;
  --trellis-edge:       #2a2a2a;
  --trellis-edge-hover: #4a4a4a;
}
```

### 4.3 Typography

```css
/* Load via @fontsource or Google Fonts */
--trellis-font-display: 'Fraunces', Georgia, serif;   /* headings, logo */
--trellis-font-body:    'DM Sans', system-ui, sans-serif; /* UI, chat */
--trellis-font-mono:    'JetBrains Mono', monospace;  /* code, paths */

/* Scale */
--trellis-text-xs:   11px;
--trellis-text-sm:   13px;
--trellis-text-base: 15px;
--trellis-text-lg:   18px;
--trellis-text-xl:   24px;
--trellis-text-2xl:  32px;
```

### 4.4 Spacing & Radius

- Base unit: `4px`. All spacing is multiples of 4.
- Border radius: `6px` for panels, `4px` for inputs, `2px` for tags.
- Sidebar width: `220px` fixed.
- Chat max-width: `680px` centered.

### 4.5 Motion Principles

- **Entrance animations**: opacity 0→1 + translateY 4px→0, duration 160ms, ease-out. Use on route change and new messages.
- **Graph nodes**: spring physics via D3 (no CSS transitions — D3 owns this).
- **Streaming text**: no special animation. Fast token render is the UX.
- **No loading spinners** for operations under 300ms. Use skeleton loaders for note loading.
- Respect `prefers-reduced-motion`. Wrap all animations in a media query check.

---

## 5. Core Features — Implementation Notes

### 5.1 Chat Interface

The chat view is the home screen. It opens to a clean input bar with a subtle prompt: *"What are you thinking about?"*

**Streaming**: Use `fetch` with `ReadableStream` to the backend `/chat/stream` endpoint. Render tokens as they arrive into the current assistant message bubble. Show a three-dot pulse while waiting for the first token.

**Session management**: Each conversation is a `chat_session` in SQLite with an auto-generated UUID, timestamp, and title (generated by the AI after the first exchange, max 6 words).

**Post-conversation extraction**: When the user ends a session (closes it, starts a new one, or after 60 seconds of inactivity), fire a background call to `/extract` with the full transcript. This returns a structured diff of wiki changes. Apply them silently. Show a subtle "✦ 3 notes updated" toast in the bottom corner.

**Model selector**: A small pill in the bottom-right of the input bar. Click to cycle: `Claude Sonnet 4` → `GPT-4o` → back. Store preference in `localStorage`.

### 5.2 Wiki / Note Browser

The wiki is a directory of `.md` files in the user's vault. Trellis owns the `wiki/` subdirectory. `raw/` is for user-imported sources (read-only to Trellis).

**Rendering**: Parse markdown with `marked.js`. Intercept `[[wiki links]]` and render them as clickable spans that navigate to that note. If the note doesn't exist yet, render as a dimmed "ghost link" — clicking it creates a stub page.

**Editing**: Notes are editable in a minimal inline editor. Autosave on blur with a 500ms debounce. Write directly to the filesystem via IPC.

**Frontmatter**: Every AI-generated note includes YAML frontmatter:
```yaml
---
title: Quantum Computing
created: 2026-04-06
updated: 2026-04-06
sources: 3
tags: [physics, computing]
type: concept  # concept | entity | source-summary | synthesis
---
```

### 5.3 Graph Visualization

The graph view renders all wiki notes as nodes and `[[wiki links]]` as edges using D3 force simulation.

**Nodes**: Sized by inbound link count (more links = larger node). Colored uniformly with `--trellis-node`. On hover: show node title tooltip and highlight all connected edges.

**Interaction**: Click a node to open the note in a side panel (split view). Drag nodes to reposition (D3 drag behavior). Scroll to zoom. Double-click blank space to reset zoom.

**Performance**: For vaults under 500 nodes, render everything. Over 500, cluster by `tags` frontmatter and show cluster bubbles that expand on click.

**Initial state (empty vault)**: Show a beautiful empty state — a single glowing node labeled "Start chatting to grow your graph" — not a blank canvas. This is the cold-start onboarding moment.

### 5.4 Ingest (PDF + Web Clip)

**PDF**: Drag-and-drop or file picker. Parse text with `pdf-parse` in the main process. Send extracted text to `/extract` endpoint with `type: "source"`. AI generates a summary page + entity updates. File is copied to `raw/` directory.

**Web clip**: User pastes a URL. Main process fetches via Node `fetch`, runs through `Readability.js`, extracts clean article text. Same pipeline as PDF from there. Store the original URL in the note's frontmatter.

**Progress**: Show an inline progress card in the Ingest view: "Reading… Extracting concepts… Updating 4 notes… Done." Each step is a real status update from the backend via SSE.

### 5.5 Command Palette

`Cmd+K` / `Ctrl+K` opens a command palette (build with `cmdk` library). Commands:
- New chat
- Open note: [fuzzy search]
- Import file
- Go to graph
- Go to settings
- Copy note as markdown

This is a power-user feature but should feel like the fastest way to do anything in the app.

---

## 6. Backend — AI Prompts

All prompts live in `backend/src/lib/prompts.ts`. Never inline prompts in route handlers.

### 6.1 Chat System Prompt

```
You are Trellis, a thoughtful AI assistant. You help users think through ideas, 
research topics, and build understanding over time.

The user has a personal knowledge base. After this conversation, key concepts 
will be extracted and added to their wiki. Write clearly and precisely — your 
responses will be referenced again.

Be direct. Avoid filler. When you're uncertain, say so.
```

### 6.2 Post-Conversation Extraction Prompt

```
You are a knowledge extraction agent. You will receive a conversation transcript 
and the current wiki index. Your job is to update the wiki.

Return a JSON object with this exact shape:
{
  "updates": [
    {
      "file": "concept-name.md",         // kebab-case filename
      "action": "create" | "update" | "append",
      "title": "Human Readable Title",
      "content": "Full markdown content of the note",
      "tags": ["tag1", "tag2"],
      "type": "concept" | "entity" | "source-summary" | "synthesis",
      "linkedTo": ["other-note.md"]      // wiki links to insert
    }
  ],
  "sessionTitle": "6 word max session title"
}

Rules:
- Only create notes for concepts substantial enough to warrant their own page
- Update existing notes rather than duplicating them
- Flag contradictions with existing notes using a "> ⚠️ Conflict:" blockquote
- Cross-link aggressively — knowledge is most useful when connected
- Do not create notes for trivial small talk or greetings
- Return ONLY valid JSON. No preamble. No markdown fences.
```

### 6.3 Session Title Prompt

```
Generate a title for this conversation in 6 words or fewer. 
Plain text only. No punctuation. Capitalize each word.
Return only the title, nothing else.
```

---

## 7. Database Schema

```sql
-- SQLite, managed by better-sqlite3 in the main process

CREATE TABLE IF NOT EXISTS chat_sessions (
  id          TEXT PRIMARY KEY,  -- UUID v4
  title       TEXT,
  created_at  INTEGER NOT NULL,  -- Unix timestamp
  updated_at  INTEGER NOT NULL,
  model       TEXT NOT NULL,
  message_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES chat_sessions(id),
  role        TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  tokens      INTEGER           -- filled in after response
);

CREATE TABLE IF NOT EXISTS wiki_ops (
  id          TEXT PRIMARY KEY,
  session_id  TEXT REFERENCES chat_sessions(id),
  file        TEXT NOT NULL,
  action      TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ingested_sources (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK(type IN ('pdf', 'web', 'text')),
  title       TEXT,
  source_path TEXT,             -- local path or URL
  wiki_file   TEXT,             -- generated summary note
  created_at  INTEGER NOT NULL
);
```

---

## 8. Subscription & Auth

**Tiers (MVP):**

| Tier | Price | Limits |
|---|---|---|
| Free trial | $0 | 50 messages, 5 ingests, no graph |
| Trellis Pro | $15/month | Unlimited messages + ingests, full graph, both models |

**Flow:**
1. User opens app → prompted to sign up via Clerk (email or Google)
2. JWT stored in Electron `safeStorage` (encrypted on disk)
3. Every API request includes `Authorization: Bearer <jwt>`
4. Backend verifies JWT with Clerk SDK, then checks `subscription_status` in Stripe
5. On free trial expiry, API returns `{ error: "trial_expired" }` → app shows upgrade modal

**Never store raw API keys on the user's machine.** All model calls go through the backend. The user never sees Anthropic or OpenAI credentials.

---

## 9. Build & Dev Workflow

```bash
# Install
npm install

# Dev (starts Electron + Vite + backend concurrently)
npm run dev

# Build distributable
npm run build        # packages for current platform
npm run build:all    # builds Win + Mac + Linux via electron-builder

# Backend dev
cd backend && npm run dev
```

**electron-builder config** (`electron-builder.yml`):
```yaml
appId: com.trellis.app
productName: Trellis
directories:
  output: dist-electron
mac:
  category: public.app-category.productivity
  hardenedRuntime: true
win:
  target: nsis
linux:
  target: AppImage
```

---

## 10. MVP Milestones (Suggested Order)

Build in this sequence. Each milestone should be shippable and testable before moving on.

**Milestone 1 — Shell**: Electron app boots, sidebar nav works, all routes render (empty states OK). Design system applied. Fonts load. Dark theme consistent.

**Milestone 2 — Chat**: Messages send and stream from backend. Sessions saved to SQLite. Session list in sidebar. Model pill works.

**Milestone 3 — Extraction**: Post-conversation pipeline runs. Wiki files written to disk. "Notes updated" toast shows. Notes browsable in Wiki view.

**Milestone 4 — Graph**: D3 graph renders from vault files. Node click opens note. Empty state is beautiful.

**Milestone 5 — Ingest**: PDF drag-and-drop works. Web URL paste works. Progress states show correctly. Ingested sources appear in wiki.

**Milestone 6 — Auth + Billing**: Clerk login gate. Stripe checkout. Trial enforcement. Upgrade modal.

**Milestone 7 — Polish**: Command palette. Onboarding flow for new users. Error states for all failure modes. Loading skeletons. App icon. About screen.

---

## 11. What Good Looks Like

Before considering the MVP done, verify:

- [ ] A brand new user can install the app, sign up, and have their first chat within 60 seconds
- [ ] After a 5-message conversation, at least one wiki note is created automatically
- [ ] The graph view shows nodes and edges with correct links after 3 conversations
- [ ] A PDF can be imported and its summary appears in the wiki within 30 seconds
- [ ] The app works fully offline except for AI calls (all local data is readable)
- [ ] The app does not crash if the backend is unreachable — graceful degraded state
- [ ] Cold start (empty vault) has a compelling empty state, not a blank screen

---

## 12. Things to Explicitly NOT Build in MVP

- Obsidian plugin
- Mobile app
- Local LLM / Ollama support (design for it — add a model option stub — but don't implement)
- Team / collaboration features
- Public sharing of notes
- Voice input
- Custom CSS themes

These are post-MVP. Scope ruthlessly.

---

*This document is the source of truth for all agents working on this codebase. When in doubt, refer back here. When this document needs updating, update it first, then change the code.*
