# Hosted chat and media entitlements (Edge Functions)

This note complements [AGENTS.md](../../AGENTS.md) at the repo root for **Supabase Edge Function** behavior. It is the source of truth for how quota, BYOK, admin, and preview headers interact.

## Server-evaluated rules

- **`profiles.is_admin`**: When `true`, `assertEntitlement` allows the request without checking trial/pro limits. Usage counters may still be recorded for hosted keys unless skipped for preview sandbox (see below).
- **Subscription**: `subscription_status === "expired"` yields HTTP 402 (`subscription_expired`). `subscription_tier === "pro"` passes entitlement for messages and ingests within plan limits (ingests use `ingest_limit`).
- **BYOK (`subscription_tier === "byok"`)**: For **messages**, entitlement passes without trial limits when the client uses BYOK headers (`x-trellis-billing-mode: byok` with a valid provider key). Hosted OpenAI/Anthropic keys are not charged to the user’s trial; usage events may still be logged with `skipCounterUpdate` where applicable.
- **Trial / free tier**: Enforced via `messages_used` / `message_limit` (with the 24h trial window helpers in `shared/billing/trialMessageWindow.ts`) and `ingests_used` / `ingest_limit`.

## Client headers (advisory)

- **`x-trellis-preview-workspace: 1`**: Requests preview-workspace UX (e.g. seeded demo). It does **not** grant quota bypass. Only **`is_admin`** (or normal pro/BYOK/trial rules) affects `assertEntitlement`.
- **Chat `previewWorkspace` in JSON body**: Same as the header: advisory for product behavior; entitlement is unchanged.

## Usage accounting

- **Chat (`chat`)**: Increments `messages_used` (or logs with skip) after a successful streamed reply, consistent with BYOK and admin preview rules in the function implementation.
- **Media (`chat-media`)**: Each successful hosted OpenAI call (transcribe, TTS, image) increments `messages_used` by 1 unless BYOK is used or the request is an admin preview sandbox (mirrors chat skip rules).

## BYOK vs hosted keys

- **BYOK**: User’s API key from Settings; no trial/house-key charge for that request path where implemented.
- **Hosted**: Trellis-configured provider keys; subject to entitlement and usage counters above.
