import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";

const functionsBaseUrl = `${import.meta.env.VITE_SUPABASE_URL?.trim() ?? ""}/functions/v1`;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

export type FeaturePostStatus = "pending" | "approved" | "rejected";
export type UpdatePostStatus = "draft" | "published";

export interface FeaturePostRecord {
  id: string;
  author_user_id: string;
  title: string;
  body: string;
  status: FeaturePostStatus;
  reviewed_at: string | null;
  reviewed_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpdatePostRecord {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body_markdown: string;
  status: UpdatePostStatus;
  published_at: string | null;
  author_user_id: string;
  created_at: string;
  updated_at: string;
}

function ensureConfigured(): void {
  if (!hasSupabaseConfig()) {
    throw new Error("Cloud features are not configured for this build yet.");
  }
}

async function getAccessToken(): Promise<string> {
  ensureConfigured();
  const {
    data: { session }
  } = await getSupabase().auth.getSession();

  if (!session?.access_token) {
    throw new Error("Sign in before continuing.");
  }

  return session.access_token;
}

async function invokeAuthedFunction<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const accessToken = await getAccessToken();
  const response = await fetch(`${functionsBaseUrl}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify(body ?? {})
  });

  if (!response.ok) {
    let message = "Request failed.";
    try {
      const payload = (await response.json()) as { error?: string; message?: string };
      message = payload.error ?? payload.message ?? message;
    } catch {
      const text = await response.text();
      if (text.trim().length > 0) {
        message = text.trim();
      }
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function listVisibleFeaturePosts(): Promise<FeaturePostRecord[]> {
  ensureConfigured();

  const { data, error } = await getSupabase()
    .from("feature_posts")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as FeaturePostRecord[];
}

export async function submitFeaturePost(input: {
  title: string;
  body: string;
}): Promise<{ post: FeaturePostRecord }> {
  return invokeAuthedFunction<{ post: FeaturePostRecord }>("feature-forum-submit", input);
}

export async function updateFeaturePostStatus(input: {
  id: string;
  status: FeaturePostStatus;
}): Promise<FeaturePostRecord> {
  ensureConfigured();

  const { data, error } = await getSupabase()
    .from("feature_posts")
    .update({
      status: input.status,
      reviewed_at: new Date().toISOString()
    })
    .eq("id", input.id)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data as FeaturePostRecord;
}

export async function listVisibleUpdatePosts(): Promise<UpdatePostRecord[]> {
  ensureConfigured();

  const { data, error } = await getSupabase()
    .from("update_posts")
    .select("*")
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as UpdatePostRecord[];
}

export async function getUpdatePostBySlug(slug: string): Promise<UpdatePostRecord | null> {
  ensureConfigured();

  const { data, error } = await getSupabase()
    .from("update_posts")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as UpdatePostRecord | null) ?? null;
}

export async function saveUpdatePost(input: Partial<UpdatePostRecord> & {
  title: string;
  slug: string;
  summary: string;
  body_markdown: string;
  status: UpdatePostStatus;
}): Promise<UpdatePostRecord> {
  ensureConfigured();

  if (input.id) {
    const { data, error } = await getSupabase()
      .from("update_posts")
      .update({
        slug: input.slug,
        title: input.title,
        summary: input.summary,
        body_markdown: input.body_markdown,
        status: input.status,
        published_at: input.status === "published" ? input.published_at ?? new Date().toISOString() : null
      })
      .eq("id", input.id)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return data as UpdatePostRecord;
  }

  const {
    data: { session }
  } = await getSupabase().auth.getSession();
  const authorId = session?.user.id;
  if (!authorId) {
    throw new Error("Sign in before creating an update.");
  }

  const { data, error } = await getSupabase()
    .from("update_posts")
    .insert({
      author_user_id: authorId,
      slug: input.slug,
      title: input.title,
      summary: input.summary,
      body_markdown: input.body_markdown,
      status: input.status,
      published_at: input.status === "published" ? new Date().toISOString() : null
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data as UpdatePostRecord;
}

export async function deleteUpdatePost(id: string): Promise<void> {
  ensureConfigured();

  const { error } = await getSupabase().from("update_posts").delete().eq("id", id);

  if (error) {
    throw error;
  }
}

export async function completeAnonymousUpgrade(): Promise<void> {
  await invokeAuthedFunction("account-upgrade-complete");
}

export function slugifyPublicTitle(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
