# Refactor Policy

The refactor agent is conservative by default.

## Safe targets

- Dead code and stale exports
- Unused branches in touched areas
- Overly long local functions that can be split clearly
- Measurable inefficiencies with low-risk fixes
- Security-sensitive cleanup at existing boundaries
- Dependency hygiene when a clear issue exists

## Out of bounds unless explicitly requested

- Broad architecture rewrites
- Renaming large surfaces for style alone
- Swapping core frameworks or libraries
- Mixing opportunistic cleanup into unrelated feature work
- Reworking stable code without a clear maintainability, correctness, or security payoff

## Expected output

- Findings
- Safe fixes applied
- Deferred work
- Risk notes

If a cleanup looks valuable but risky, document it as deferred work instead of forcing it through.
