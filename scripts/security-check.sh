#!/usr/bin/env bash
# Scan the working tree for common secret patterns before push.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

FAIL=0

scan() {
  local label="$1"
  local pattern="$2"
  shift 2
  local args=(git grep -nE "$pattern" -- . ':!scripts/security-check.sh')
  for exclude in "$@"; do
    args+=("$exclude")
  done
  if "${args[@]}" 2>/dev/null; then
    echo "FAIL: $label"
    FAIL=1
  fi
}

echo "Running security checks..."

scan "JWT literals" \
  'eyJhbGci[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' \
  ':!supabase/functions/_shared/cloud.test.ts' \
  ':!.env.example'

scan "OpenAI secret keys" 'sk-[A-Za-z0-9]{20,}' ':!supabase/functions/_shared/cloud.test.ts'

scan "Stripe live keys" 'sk_live_[A-Za-z0-9]+'
scan "Stripe webhook secrets" 'whsec_[A-Za-z0-9]{20,}' ':!.env.example'

if [[ -f .env ]]; then
  echo "WARN: .env exists locally (correctly gitignored). Do not commit it."
fi

if [[ -d .pnpm-store ]]; then
  echo "WARN: .pnpm-store exists locally. It must not be committed."
  if git ls-files --error-unmatch .pnpm-store >/dev/null 2>&1; then
    echo "FAIL: .pnpm-store is tracked by git"
    FAIL=1
  fi
fi

if [[ "$FAIL" -ne 0 ]]; then
  echo ""
  echo "Security check failed. Remove or redact matches before publishing."
  exit 1
fi

echo "Security check passed."
