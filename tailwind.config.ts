import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        panel: "6px",
        field: "4px",
        tag: "2px"
      },
      colors: {
        trellis: {
          bg: "var(--trellis-bg)",
          surface: "var(--trellis-surface)",
          "surface-2": "var(--trellis-surface-2)",
          border: "var(--trellis-border)",
          text: "var(--trellis-text)",
          muted: "var(--trellis-text-muted)",
          faint: "var(--trellis-text-faint)",
          accent: "var(--trellis-accent)",
          "accent-dim": "var(--trellis-accent-dim)",
          success: "var(--trellis-success)",
          warning: "var(--trellis-warning)",
          error: "var(--trellis-error)",
          node: "var(--trellis-node)",
          edge: "var(--trellis-edge)"
        }
      },
      fontFamily: {
        display: "var(--trellis-font-display)",
        body: "var(--trellis-font-body)",
        mono: "var(--trellis-font-mono)"
      },
      fontSize: {
        xs: "var(--trellis-text-xs)",
        sm: "var(--trellis-text-sm)",
        base: "var(--trellis-text-base)",
        lg: "var(--trellis-text-lg)",
        xl: "var(--trellis-text-xl)",
        "2xl": "var(--trellis-text-2xl)"
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(200, 169, 110, 0.16), 0 12px 40px rgba(0, 0, 0, 0.35)",
        inset: "inset 0 1px 0 rgba(255, 255, 255, 0.02)"
      },
      animation: {
        "fade-rise": "fade-rise 160ms ease-out",
        "toast-exit": "toast-exit 200ms ease-in forwards",
        pulseDots: "pulse-dots 1000ms infinite",
        thinkingEllipsis: "thinking-ellipsis 1.2s ease-in-out infinite"
      },
      keyframes: {
        "fade-rise": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        "toast-exit": {
          "0%": { opacity: "1", transform: "translateY(0)" },
          "100%": { opacity: "0", transform: "translateY(10px)" }
        },
        "pulse-dots": {
          "0%, 80%, 100%": { opacity: "0.25" },
          "40%": { opacity: "1" }
        },
        "thinking-ellipsis": {
          "0%, 100%": { opacity: "0.2" },
          "50%": { opacity: "1" }
        }
      }
    }
  },
  plugins: []
};

export default config;

