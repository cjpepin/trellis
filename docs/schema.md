# Trellis Wiki Schema

User-facing name: **Strand** (a single markdown file in the vault). This document uses “note” where it refers to the on-disk shape.

## Frontmatter

All AI-generated notes must begin with YAML frontmatter:

```yaml
---
title: Quantum Computing
created: 2026-04-06
updated: 2026-04-06
sources: 3
tags: [physics, computing]
type: concept
---
```

## Note Types

- `concept`: durable ideas or subject overviews
- `entity`: people, organizations, products, places
- `source-summary`: summaries created from PDFs, articles, or clipped text
- `synthesis`: notes that connect multiple existing ideas

## Linking

- Internal links use `[[note-title]]`.
- Filenames are always `kebab-case.md`.
- Missing links should be preserved as ghost links so the UI can create stub notes on demand.

## Optional provenance fields

The app may add these over time for lineage (ignored by older builds if absent):

- `originSessionId`: chat session id that first created or last meaningfully updated the Strand (product-dependent).
- `strandKind`: optional subtype label for UI (e.g. `claim`, `synthesis`) — must remain compatible with `type`.

## Thoughts (interaction layer)

Thoughts are **not** wiki files. They are fast captures stored in the local SQLite database (`thoughts` table), scoped by `vault_id`, with optional links to Strands via enrichment metadata. The graph view may render recent Thoughts as secondary nodes connected to related Strands when enrichment finds likely matches.

## Graph Rules

- Each note becomes one node.
- Each `[[wiki link]]` becomes one directed edge.
- Node size is derived from inbound link count.
- When a vault exceeds 500 notes, the renderer may cluster nodes by tag before expanding detail on demand.
- The graph may also show **Thought** overlays (ephemeral nodes) linked to Strands when enrichment relates a capture to existing notes.

