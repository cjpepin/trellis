import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";

const repoRoot = path.resolve(__dirname, "..");
const webRoot = path.join(repoRoot, "apps", "web");

function contentSecurityPolicyMeta(mode: string): Plugin {
  return {
    name: "trellis-csp-meta",
    transformIndexHtml(html) {
      if (mode !== "production") {
        return html;
      }

      const csp = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        "connect-src 'self' https: wss: http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*"
      ].join("; ");

      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`
      );
    }
  };
}

const projectAliases = {
  "@": path.resolve(webRoot, "src"),
  "@electron": path.resolve(repoRoot, "apps", "desktop", "electron"),
  "@shared": path.resolve(repoRoot, "packages", "shared", "src"),
  "@trellis/shared": path.resolve(repoRoot, "packages", "shared", "src"),
  "@trellis/contracts": path.resolve(repoRoot, "packages", "contracts", "src")
};
const buildDir = path.join("out", "build");
const electronOutDir = path.join(buildDir, "electron");
const rendererOutDir = path.join(buildDir, "renderer");

/** When set (e.g. Capacitor / SPA CI), `vite build` emits only `out/build/renderer` — no Electron bundles. */
const webOnlyBuild = process.env.TRELLIS_VITE_WEB_ONLY === "1";
/** Hosted SPA build for production web deploys: use absolute asset paths for history-route refreshes. */
const hostedWebBuild = process.env.TRELLIS_VITE_HOSTED_WEB === "1";
const demoBasePath = process.env.VITE_WEB_BASE_PATH?.trim();

/**
 * Vite injects `import.meta.env` for the renderer, but the Electron main bundle runs in Node and
 * does not load `.env` at runtime. Bake the same `VITE_*` values into the main process so chat and
 * other IPC handlers see Supabase URL and publishable key after `vite build`.
 *
 * Do not define `VITE_DEV_SERVER_URL` here: in dev, vite-plugin-electron sets it after the dev server
 * listens; `alignElectronDevServerUrlWithViteHost` then rewrites it to IPv4 loopback to match `server.host`.
 */
function electronMainEnvDefine(mode: string): Record<string, string> {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    "process.env.VITE_SUPABASE_URL": JSON.stringify(env.VITE_SUPABASE_URL ?? ""),
    "process.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "")
  };
}

/**
 * vite-plugin-electron sets `VITE_DEV_SERVER_URL` using the hostname "localhost". Our dev server binds
 * `server.host` to 127.0.0.1 only, so on some systems `localhost` resolves to IPv6 first (::1) and the
 * renderer never loads (blank window). Force the loopback URL to IPv4 to match the listening socket.
 */
function alignElectronDevServerUrlWithViteHost(): Plugin {
  return {
    name: "trellis-electron-dev-server-url-ipv4",
    apply: "serve",
    configureServer(server) {
      server.httpServer?.once("listening", () => {
        const addressInfo = server.httpServer?.address();
        if (!addressInfo || typeof addressInfo !== "object") {
          return;
        }

        const { port } = addressInfo;
        const options = server.config.server;
        const protocol = options.https ? "https" : "http";
        const devBase = server.config.base;
        const path2 = typeof options.open === "string" ? options.open : devBase;
        process.env.VITE_DEV_SERVER_URL = path2.startsWith("http")
          ? path2
          : `${protocol}://127.0.0.1:${port}${path2}`;
      });
    }
  };
}

export default defineConfig(({ mode }) => ({
  root: webRoot,
  plugins: [
    contentSecurityPolicyMeta(mode),
    react(),
    ...(webOnlyBuild
      ? []
      : [
          electron({
            main: {
              entry: "apps/desktop/electron/main.ts",
              vite: {
                define: electronMainEnvDefine(mode),
                resolve: {
                  alias: projectAliases
                },
                build: {
                  outDir: electronOutDir,
                  rollupOptions: {
                    input: {
                      main: path.resolve(repoRoot, "apps/desktop/electron/main.ts"),
                      extractionWorker: path.resolve(
                        repoRoot,
                        "apps/desktop/electron/extractionWorker.ts"
                      )
                    },
                    external: [
                      "jsdom",
                      "canvas",
                      "@mozilla/readability",
                      "better-sqlite3",
                      "node-llama-cpp"
                    ],
                    output: {
                      entryFileNames: "[name].js"
                    }
                  }
                }
              }
            },
            preload: {
              input: "apps/desktop/electron/preload.ts",
              vite: {
                resolve: {
                  alias: projectAliases
                },
                build: {
                  outDir: electronOutDir,
                  rollupOptions: {
                    output: {
                      entryFileNames: "preload.cjs"
                    }
                  }
                }
              }
            }
          }),
          alignElectronDevServerUrlWithViteHost()
        ])
  ],
  resolve: {
    alias: projectAliases
  },
  css: {
    postcss: path.resolve(__dirname, "postcss.config.cjs")
  },
  /** Capacitor serves the bundle from app-local URLs; hosted web needs absolute paths for deep-link refreshes. */
  base: demoBasePath
    ? demoBasePath.endsWith("/")
      ? demoBasePath
      : `${demoBasePath}/`
    : hostedWebBuild
      ? "/"
      : webOnlyBuild
        ? "./"
        : "/",
  build: {
    outDir: rendererOutDir,
    emptyOutDir: true
  },
  server: {
    host: "127.0.0.1",
    port: 5173
  }
}));
