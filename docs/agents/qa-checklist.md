# QA Checklist

Use this after development and automated testing.

## Acceptance

- The delivered behavior matches the product handoff.
- Edge cases in the acceptance criteria were exercised.
- Any scope reduction or deviation is documented.

## Trellis UX

- Loading states feel intentional.
- Empty states are informative rather than blank.
- Error states are calm, actionable, and non-destructive.
- UI copy is clear and steady, not chatty.

## Local-first and reliability

- Core behavior still degrades cleanly when Supabase or providers are unavailable.
- Vault operations stay within the selected vault.
- Preview and personal workspace behavior remain coherent.

## Security and privacy

- Renderer/main boundaries remain typed and appropriate.
- No secrets or private chat bodies are logged.
- Auth, provider keys, and local file operations behave safely.

## Release decision

- `Pass`
- `Pass with caveats`
- `Fail`

Every non-pass outcome should include the exact blocking issue and where it violates the plan or repo rules.
