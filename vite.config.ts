import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";

const projectAliases = {
  "@": path.resolve(__dirname, "src"),
  "@electron": path.resolve(__dirname, "electron"),
  "@shared": path.resolve(__dirname, "shared")
};

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          resolve: {
            alias: projectAliases
          },
          build: {
            outDir: "dist-electron",
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
            outDir: "dist-electron",
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
    outDir: "dist",
    emptyOutDir: true
  },
  server: {
    host: "127.0.0.1",
    port: 5173
  }
});
