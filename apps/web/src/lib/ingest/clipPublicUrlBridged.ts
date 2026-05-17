import { Readability } from "@mozilla/readability";
import type { IngestedDraft } from "@trellis/contracts";
import { hasElectronPreloadBridge } from "@/lib/platform/runtime";
import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";

const functionsBaseUrl = `${import.meta.env.VITE_SUPABASE_URL?.trim() ?? ""}/functions/v1`;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

async function readJsonError(response: Response, fallback: string): Promise<Error> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (typeof payload.error === "string" && payload.error.length > 0) {
      return new Error(payload.error);
    }
  } catch {
    const text = await response.text();
    if (text.trim().length > 0) {
      return new Error(text.trim());
    }
  }
  return new Error(fallback);
}

export async function clipPublicUrlBridged(url: string): Promise<IngestedDraft> {
  const draftUrl = new URL(url);

  if (draftUrl.protocol !== "https:" && draftUrl.protocol !== "http:") {
    throw new Error("Use an http or https URL.");
  }

  if (hasElectronPreloadBridge()) {
    return window.trellis.ingest.clipUrl({ url: draftUrl.toString() });
  }

  if (!hasSupabaseConfig() || publishableKey.length === 0) {
    throw new Error("Sign in to clip web pages in the browser.");
  }

  const {
    data: { session }
  } = await getSupabase().auth.getSession();

  if (!session?.access_token) {
    throw new Error("Sign in to clip web pages.");
  }

  const response = await fetch(`${functionsBaseUrl}/public-page-fetch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: publishableKey,
      Authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify({ url: draftUrl.toString() })
  });

  if (!response.ok) {
    throw await readJsonError(response, "Could not fetch that page.");
  }

  const payload = (await response.json()) as { html?: string; finalUrl?: string };

  if (typeof payload.html !== "string" || typeof payload.finalUrl !== "string") {
    throw new Error("Invalid response when clipping that page.");
  }

  const doc = new DOMParser().parseFromString(payload.html, "text/html");
  const article = new Readability(doc).parse();

  if (!article?.textContent) {
    throw new Error("Could not extract readable content from that page.");
  }

  return {
    title: article.title || "Untitled Article",
    content: article.textContent.trim(),
    sourcePath: payload.finalUrl,
    sourceType: "web"
  };
}
