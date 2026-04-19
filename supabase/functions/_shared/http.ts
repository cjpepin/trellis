export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-trellis-billing-mode, x-trellis-provider, x-trellis-provider-key, x-trellis-preview-workspace",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
} as const;
