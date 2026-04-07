# Trellis Wiki Schema

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

## Graph Rules

- Each note becomes one node.
- Each `[[wiki link]]` becomes one directed edge.
- Node size is derived from inbound link count.
- When a vault exceeds 500 notes, the renderer may cluster nodes by tag before expanding detail on demand.

