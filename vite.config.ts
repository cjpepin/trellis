import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";

const projectAliases = {
  "@": path.resolve(__dirname, "src"),
  "@electron": path.resolve(__dirname, "electron"),
  "@shared": path.resolve(__dirname, "shared")
};
const buildDir = path.join("out", "build");
const electronOutDir = path.join(buildDir, "electron");
const rendererOutDir = path.join(buildDir, "renderer");

/**
 * Vite injects `import.meta.env` for the renderer, but the Electron main bundle runs in Node and
 * does not load `.env` at runtime. Bake the same `VITE_*` values into the main process so chat and
 * other IPC handlers see Supabase URL and publishable key after `vite build`.
 *
 * Do not define `VITE_DEV_SERVER_URL` here: in dev, vite-plugin-electron sets it on `process.env`
 * after the dev server listens, and the Electron child inherits that env.
 */
function electronMainEnvDefine(mode: string): Record<string, string> {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    "process.env.VITE_SUPABASE_URL": JSON.stringify(env.VITE_SUPABASE_URL ?? ""),
    "process.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "")
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          define: electronMainEnvDefine(mode),
          resolve: {
            alias: projectAliases
          },
          build: {
            outDir: electronOutDir,
            rollupOptions: {
              external: [
                "jsdom",
                "canvas",
                "@mozilla/readability",
                "@electric-sql/pglite",
                "node-llama-cpp"
              ],
              output: {
                entryFileNames: "main.js"
              }
            }
          }
        }
      },
      preload: {
        input: "electron/preload.ts",
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
    })
  ],
  resolve: {
    alias: projectAliases
  },
  build: {
    outDir: rendererOutDir,
    emptyOutDir: true
  },
  server: {
    host: "127.0.0.1",
    port: 5173
  }
}));
