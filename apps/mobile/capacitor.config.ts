import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native shells load the same SPA as production web from `out/build/renderer` (see `config/vite.config.ts`).
 * Run `npm run build:cap` before opening Xcode so `webDir` is populated and `cap sync` copies fresh assets.
 *
 * `VITE_*` variables are inlined at `vite build` time; set them in `.env` / CI secrets for the bundle you ship.
 */
const config: CapacitorConfig = {
  appId: "com.trellis.app",
  appName: "Trellis",
  webDir: "../../out/build/renderer"
};

export default config;
