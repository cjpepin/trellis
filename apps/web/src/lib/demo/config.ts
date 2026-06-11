export function isDemoMode(): boolean {
  return import.meta.env.VITE_DEMO_MODE === "true";
}

export function demoWebBasePath(): string {
  const base = import.meta.env.VITE_WEB_BASE_PATH?.trim() || "/trellis/demo";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

export function demoApiBase(): string {
  const fromEnv = import.meta.env.VITE_DEMO_API_BASE?.trim();
  if (fromEnv) {
    return fromEnv.endsWith("/") ? fromEnv.slice(0, -1) : fromEnv;
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/api/demo`;
  }
  return "";
}

export const DEMO_BUCKET_ID = "preview-main-bucket";

export const DEMO_USER = {
  id: "demo-user-0000-4000-8000-000000000001",
  email: "demo@trellis.local",
};
