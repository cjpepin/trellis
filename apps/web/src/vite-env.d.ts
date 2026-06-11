/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DOWNLOAD_MAC_URL?: string;
  readonly VITE_DOWNLOAD_MAC_VERSION?: string;
  readonly VITE_SITE_URL?: string;
  readonly VITE_SUPPORT_EMAIL?: string;
  readonly VITE_STRIPE_CHECKOUT_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "turndown-plugin-gfm" {
  import type TurndownService from "turndown";

  export function gfm(service: TurndownService): void;
}
