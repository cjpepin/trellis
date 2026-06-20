import type { ThemeName } from "@trellis/contracts";
import { applyTheme } from "@/lib/settings";

function readPortfolioThemeFromUrl(): ThemeName | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("theme");
  if (value === "light" || value === "dark") {
    return value;
  }
  return null;
}

function readPortfolioThemeFromParent(): ThemeName | null {
  if (typeof window === "undefined" || window.parent === window) {
    return null;
  }

  try {
    const parentDark = window.parent.document.documentElement.classList.contains("dark");
    return parentDark ? "dark" : "light";
  } catch {
    return null;
  }
}

function resolvePortfolioTheme(): ThemeName {
  return readPortfolioThemeFromUrl() ?? readPortfolioThemeFromParent() ?? "dark";
}

export function syncPortfolioThemeOnce(): void {
  applyTheme(resolvePortfolioTheme());
}

export function subscribePortfolioThemeSync(): () => void {
  syncPortfolioThemeOnce();

  if (typeof window === "undefined" || window.parent === window) {
    return () => undefined;
  }

  let parentRoot: HTMLElement | null = null;
  try {
    parentRoot = window.parent.document.documentElement;
  } catch {
    return () => undefined;
  }

  const observer = new MutationObserver(() => {
    syncPortfolioThemeOnce();
  });

  observer.observe(parentRoot, { attributes: true, attributeFilter: ["class"] });

  return () => {
    observer.disconnect();
  };
}
