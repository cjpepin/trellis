---
name: feature-workflow
description: Route Trellis work through the shared multi-agent workflow. Use when a feature request should move through product planning, development, testing, and QA in a consistent order.
---

# Feature Workflow

Use this skill to orchestrate work, not to replace the role-specific skills.

## Sequence

1. Start with `product-plan-agent`.
2. Hand the approved plan to `senior-dev-agent`.
3. Send the implementation handoff to `senior-tester-agent`.
4. Send the combined handoff set to `senior-qa-agent`.

## Rules

- Keep the product handoff as the contract for the downstream agents. Plans and implementations should respect Trellis’s OpenAI-and-Anthropic chat story; single-provider assumptions belong in the handoff with explicit scope.
- If scope changes materially during development, route back through product planning before continuing.
- Use `repo-refactor-agent` only as a separate hygiene pass or when the request explicitly includes cleanup/security work.

## Shared references

- [`docs/agents/README.md`](../../../docs/agents/README.md)
- [`docs/agents/workflow.md`](../../../docs/agents/workflow.md)
- [`docs/agents/handoffs.md`](../../../docs/agents/handoffs.md)
