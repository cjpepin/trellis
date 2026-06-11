# Agent Workflow

Trellis uses a repo-local Codex workflow so feature work follows the same shape every time:

1. Product planning
2. Development
3. Automated testing
4. QA validation

The root [`AGENTS.md`](/Users/connorpepin/Cursor/mnemo/AGENTS.md) stays the global repo contract. The role skills in [`/Users/connorpepin/Cursor/mnemo/.codex/skills`](/Users/connorpepin/Cursor/mnemo/.codex/skills) specialize that contract for each phase.

## Roles

- `product-plan-agent`
  - Researches the request, current implementation, and Trellis product constraints.
  - Produces the implementation handoff.
- `senior-dev-agent`
  - Implements approved scope and records what changed.
- `senior-tester-agent`
  - Adds or expands automated coverage and reports remaining gaps.
- `senior-qa-agent`
  - Validates acceptance, regression risk, degraded states, and release readiness.
- `repo-refactor-agent`
  - Runs conservative cleanup, security, and maintainability passes on explicit request.
- `feature-workflow`
  - Lightweight router that reminds Codex which role to use next.

## Quick Start

- New feature or UX change:
  - Start with `product-plan-agent`.
- Approved change ready to build:
  - Hand off to `senior-dev-agent`.
- Behavior changed and needs automated coverage:
  - Hand off to `senior-tester-agent`.
- Change is ready for release-style validation:
  - Hand off to `senior-qa-agent`.
- Cleanup or repo health request:
  - Use `repo-refactor-agent`.

## Which Agent Do I Run?

- “What should we build and how should it work?”
  - `product-plan-agent`
- “Implement this approved change.”
  - `senior-dev-agent`
- “Add tests or validate regressions automatically.”
  - `senior-tester-agent`
- “Is this actually ready and what did we miss?”
  - `senior-qa-agent`
- “Clean up this area, remove dead code, and reduce risk.”
  - `repo-refactor-agent`
- “Follow the whole workflow.”
  - `feature-workflow`

## Handoffs

Use the templates in [`/Users/connorpepin/Cursor/mnemo/docs/agents/handoffs.md`](/Users/connorpepin/Cursor/mnemo/docs/agents/handoffs.md). Every role should preserve the prior handoff context instead of restating it loosely from memory.

## Testing Layers

Use the lightest layer that can catch the risk:

- Node tests:
  - Data contracts, extraction logic, seed integrity, utility behavior
- Playwright Electron E2E:
  - User-critical routes, navigation, workspace flows, durable regression checks
- QA/manual validation:
  - Acceptance, UX clarity, degraded states, and release risk beyond automation

More detail lives in [`/Users/connorpepin/Cursor/mnemo/docs/testing/electron-e2e.md`](/Users/connorpepin/Cursor/mnemo/docs/testing/electron-e2e.md).
