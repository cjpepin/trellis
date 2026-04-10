# Workflow

## Default lifecycle

1. `product-plan-agent`
2. `senior-dev-agent`
3. `senior-tester-agent`
4. `senior-qa-agent`

Use `repo-refactor-agent` only as a separate maintenance or cleanup pass, not as a silent extra step inside feature delivery.

## Thread sequencing

- Keep planning in a product thread until the request is decision-complete.
- Start development from the approved product handoff.
- Start tester and QA passes once implementation is stable enough to validate.
- If implementation reveals a material scope change, return to product planning before continuing.

## Handoff rules

- Preserve the previous role output in the next role's context.
- Do not replace a structured handoff with a free-form summary.
- Tie failures back to acceptance criteria, repo rules, or QA checklist items.
- If verification was skipped, state exactly what was skipped and why.

## Trellis-specific concerns to carry through every phase

- Local-first behavior must remain useful when cloud services are unavailable.
- Vault writes must stay within the configured vault boundary.
- Renderer and main process responsibilities stay separated through typed IPC.
- Loading, empty, error, and degraded states are part of feature completeness.
- Private message content and secrets must not leak to logs or cloud tables.
