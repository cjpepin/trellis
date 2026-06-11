-- Trellis cloud demo seed (generated from fixtures/demo-seed/trellis-cloud.json)

INSERT INTO trellis.profiles (id, email, is_admin) VALUES ('00000000-0000-4000-8000-000000000201'::uuid, 'demo-trellis@trellis.local', true) ON CONFLICT (id) DO UPDATE SET is_admin = EXCLUDED.is_admin;

INSERT INTO trellis.workspaces (id, owner_user_id, name, slug, migration_status) VALUES ('55555555-5555-4555-8555-555555555501'::uuid, '00000000-0000-4000-8000-000000000201'::uuid, 'Demo Vault', 'demo-vault', 'completed') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO trellis.notes (id, workspace_id, slug, title, markdown_body, frontmatter_json, excerpt, note_type, folder_path, source_count)
VALUES
  ('66666666-6666-4666-8666-666666666601'::uuid, '55555555-5555-4555-8555-555555555501'::uuid, 'trellis-roadmap', 'Trellis Roadmap', '---
title: Trellis Roadmap
tags: [product, roadmap]
type: concept
---
A running map of bets that compound the product. Links to [[Local First Principles]] and [[Notes From Chats]].

## Q2 bets
- Make first-run value legible within the first session.
- Make extracted notes easier to trust and edit.
- Make local-versus-cloud boundaries obvious.', '{"tags":["product","roadmap"],"type":"concept","sources":2}'::jsonb, 'Quarterly themes for local-first knowledge capture.', 'concept', 'wiki', 2),
  ('66666666-6666-4666-8666-666666666602'::uuid, '55555555-5555-4555-8555-555555555501'::uuid, 'local-first-principles', 'Local First Principles', '---
title: Local First Principles
tags: [research]
type: concept
---
Local-first software keeps the authoritative copy on the device. Cloud is for sync and backup, not the primary read path.

See [[Trellis Roadmap]] for how this shows up in product bets.', '{"tags":["research"],"type":"concept","sources":1}'::jsonb, 'Why user-owned vaults matter for trust and speed.', 'concept', 'wiki', 1),
  ('66666666-6666-4666-8666-666666666603'::uuid, '55555555-5555-4555-8555-555555555501'::uuid, 'notes-from-chats', 'Notes From Chats', '---
title: Notes From Chats
tags: [synthesis]
type: synthesis
---
Chat sessions are a rich source of provisional notes. Trellis promotes the durable ones into the vault.

Referenced in [[Trellis Roadmap]] and the Preview Workspace seed sessions.', '{"tags":["synthesis"],"type":"synthesis","sources":4}'::jsonb, 'Patterns extracted from recent assistant conversations.', 'synthesis', 'wiki', 4),
  ('66666666-6666-4666-8666-666666666604'::uuid, '55555555-5555-4555-8555-555555555501'::uuid, 'trust-signals', 'Trust Signals', '---
title: Trust Signals
tags: [product]
type: concept
---
Provenance, edit history, and obvious source links help users trust automated extractions.', '{"tags":["product"],"type":"concept","sources":1}'::jsonb, 'What makes extracted notes feel safe to keep.', 'concept', 'wiki', 1),
  ('66666666-6666-4666-8666-666666666605'::uuid, '55555555-5555-4555-8555-555555555501'::uuid, 'preview-workspace', 'Preview Workspace', '---
title: Preview Workspace
tags: [product]
type: entity
---
The preview workspace is an isolated vault with seeded chats and notes. Reset restores the shipped fixture.', '{"tags":["product"],"type":"entity","sources":0}'::jsonb, 'The editable sandbox shipped with Trellis desktop.', 'entity', 'wiki', 0)
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, markdown_body = EXCLUDED.markdown_body, excerpt = EXCLUDED.excerpt;

INSERT INTO trellis.note_links (workspace_id, source_note_id, target_slug, target_title)
VALUES
  ('55555555-5555-4555-8555-555555555501'::uuid, '66666666-6666-4666-8666-666666666601'::uuid, 'local-first-principles', 'Local First Principles'),
  ('55555555-5555-4555-8555-555555555501'::uuid, '66666666-6666-4666-8666-666666666601'::uuid, 'notes-from-chats', 'Notes From Chats'),
  ('55555555-5555-4555-8555-555555555501'::uuid, '66666666-6666-4666-8666-666666666602'::uuid, 'trellis-roadmap', 'Trellis Roadmap'),
  ('55555555-5555-4555-8555-555555555501'::uuid, '66666666-6666-4666-8666-666666666603'::uuid, 'trellis-roadmap', 'Trellis Roadmap'),
  ('55555555-5555-4555-8555-555555555501'::uuid, '66666666-6666-4666-8666-666666666603'::uuid, 'trust-signals', 'Trust Signals'),
  ('55555555-5555-4555-8555-555555555501'::uuid, '66666666-6666-4666-8666-666666666605'::uuid, 'trellis-roadmap', 'Trellis Roadmap')
ON CONFLICT (workspace_id, source_note_id, target_slug) DO UPDATE SET target_title = EXCLUDED.target_title;

INSERT INTO trellis.chat_sessions (id, workspace_id, legacy_id, title, model, message_count)
VALUES
  ('77777777-7777-4777-8777-777777777701'::uuid, '55555555-5555-4555-8555-555555555501'::uuid, 'preview-session-roadmap', 'Roadmap review with assistant', 'gpt-4.1-mini', 4),
  ('77777777-7777-4777-8777-777777777702'::uuid, '55555555-5555-4555-8555-555555555501'::uuid, 'preview-session-extraction', 'Notes from chats', 'gpt-4.1-mini', 4)
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, message_count = EXCLUDED.message_count;

INSERT INTO trellis.chat_messages (id, session_id, role, content, created_at)
VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0001'::uuid, '77777777-7777-4777-8777-777777777701'::uuid, 'user', 'Summarize the themes in [[Trellis Roadmap]] for a design partner email.', '2026-04-01T16:00:00.000Z'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0002'::uuid, '77777777-7777-4777-8777-777777777701'::uuid, 'assistant', 'The roadmap centers on first-run clarity, trustworthy extractions, and obvious data boundaries — all tied to [[Local First Principles]].', '2026-04-01T16:01:00.000Z'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0003'::uuid, '77777777-7777-4777-8777-777777777702'::uuid, 'user', 'What patterns should become notes from our last three chats?', '2026-04-02T10:00:00.000Z'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0004'::uuid, '77777777-7777-4777-8777-777777777702'::uuid, 'assistant', 'Promote provenance cues into [[Trust Signals]] and link the synthesis in [[Notes From Chats]].', '2026-04-02T10:02:00.000Z')
ON CONFLICT (id) DO NOTHING;

