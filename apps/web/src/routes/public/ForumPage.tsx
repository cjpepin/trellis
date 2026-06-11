import { useEffect, useMemo, useState } from "react";
import { PublicLayout } from "@/components/public/PublicLayout";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useSupabaseSessionState } from "@/hooks/useSupabaseSessionState";
import {
  listVisibleFeaturePosts,
  submitFeaturePost,
  updateFeaturePostStatus,
  type FeaturePostRecord,
  type FeaturePostStatus
} from "@/lib/publicContent";

function statusLabel(status: FeaturePostStatus): string {
  if (status === "approved") {
    return "Approved";
  }
  if (status === "rejected") {
    return "Rejected";
  }
  return "Pending review";
}

export function ForumPage() {
  usePageMeta({
    title: "Feature forum",
    description: "Read approved Trellis feature ideas and submit new requests when signed in.",
    pathname: "/forum"
  });

  const { session, isAdmin, isAnonymousUser } = useSupabaseSessionState();
  const [posts, setPosts] = useState<FeaturePostRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadPosts(): Promise<void> {
    setLoading(true);
    try {
      setPosts(await listVisibleFeaturePosts());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not load feature posts.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPosts();
  }, []);

  const myUserId = session?.user.id ?? null;
  const approvedPosts = posts.filter((post) => post.status === "approved");
  const personalQueue = myUserId ? posts.filter((post) => post.author_user_id === myUserId && post.status !== "approved") : [];
  const moderationQueue = useMemo(
    () => (isAdmin ? posts.filter((post) => post.status === "pending") : []),
    [isAdmin, posts]
  );

  async function handleSubmit(): Promise<void> {
    if (!title.trim() || !body.trim()) {
      setErrorMessage("Add a title and a short explanation before submitting.");
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      await submitFeaturePost({
        title: title.trim(),
        body: body.trim()
      });
      setTitle("");
      setBody("");
      setStatusMessage("Feature idea submitted for review.");
      await loadPosts();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not submit that feature idea.");
    } finally {
      setSubmitting(false);
    }
  }

  async function moderate(id: string, status: FeaturePostStatus): Promise<void> {
    try {
      await updateFeaturePostStatus({ id, status });
      await loadPosts();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not update that feature post.");
    }
  }

  return (
    <PublicLayout>
      <section className="mx-auto w-full max-w-6xl px-6 py-16">
        <div className="mb-8">
          <h1 className="font-display text-5xl text-trellis-text">Feature forum</h1>
          <p className="mt-4 max-w-3xl text-base leading-8 text-trellis-muted">
            Public visitors only see approved ideas. Signed-in users can submit requests, and admins
            can review them before they appear here.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <div className="space-y-4">
            {loading ? (
              <div className="trellis-panel rounded-panel border border-trellis-border px-5 py-5 text-sm text-trellis-muted">
                Loading feature ideas…
              </div>
            ) : approvedPosts.length > 0 ? (
              approvedPosts.map((post) => (
                <article key={post.id} className="trellis-panel rounded-panel border border-trellis-border px-5 py-5">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="font-display text-3xl text-trellis-text">{post.title}</h2>
                    <span className="rounded-full border border-trellis-accent/25 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-trellis-accent">
                      {statusLabel(post.status)}
                    </span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-trellis-muted">{post.body}</p>
                </article>
              ))
            ) : (
              <div className="trellis-panel rounded-panel border border-dashed border-trellis-border px-5 py-5 text-sm text-trellis-muted">
                No approved feature posts yet.
              </div>
            )}
          </div>

          <aside className="space-y-6">
            <div className="trellis-elevated rounded-panel border border-trellis-border bg-trellis-surface/90 px-5 py-5">
              <p className="font-display text-3xl text-trellis-text">Submit an idea</p>
              <p className="mt-2 text-sm leading-7 text-trellis-muted">
                Only signed-in non-guest users can submit ideas. New posts stay private until an admin approves them.
              </p>
              {session && !isAnonymousUser ? (
                <div className="mt-4 grid gap-3">
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="trellis-input"
                    placeholder="Short feature title"
                  />
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    className="trellis-input min-h-[180px] resize-y py-3"
                    placeholder="Describe the problem, who it helps, and what a good outcome looks like."
                  />
                  <button
                    type="button"
                    disabled={submitting}
                    className="trellis-accent-button rounded-field border px-4 py-3 text-sm transition"
                    onClick={() => {
                      void handleSubmit();
                    }}
                  >
                    {submitting ? "Submitting…" : "Submit for review"}
                  </button>
                </div>
              ) : (
                <div className="mt-4 rounded-panel border border-dashed border-trellis-border px-4 py-4 text-sm leading-7 text-trellis-muted">
                  Sign in with a full account to post in the forum. Guest sessions can still explore the product, but they cannot publish requests.
                </div>
              )}
              {statusMessage && <p className="mt-3 text-xs text-trellis-success">{statusMessage}</p>}
              {errorMessage && <p className="mt-3 text-xs text-trellis-error">{errorMessage}</p>}
            </div>

            {personalQueue.length > 0 && (
              <div className="trellis-panel rounded-panel border border-trellis-border px-5 py-5">
                <p className="font-display text-2xl text-trellis-text">Your submissions</p>
                <div className="mt-4 space-y-3">
                  {personalQueue.map((post) => (
                    <div key={post.id} className="rounded-panel border border-trellis-border bg-trellis-surface-2/70 px-4 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-trellis-text">{post.title}</p>
                        <span className="text-[11px] uppercase tracking-[0.14em] text-trellis-faint">
                          {statusLabel(post.status)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {isAdmin && (
              <div className="trellis-panel rounded-panel border border-trellis-border px-5 py-5">
                <p className="font-display text-2xl text-trellis-text">Moderation queue</p>
                {moderationQueue.length === 0 ? (
                  <p className="mt-3 text-sm leading-7 text-trellis-muted">No pending posts right now.</p>
                ) : (
                  <div className="mt-4 space-y-4">
                    {moderationQueue.map((post) => (
                      <div key={post.id} className="rounded-panel border border-trellis-border bg-trellis-surface-2/70 px-4 py-4">
                        <p className="text-sm font-medium text-trellis-text">{post.title}</p>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-trellis-muted">{post.body}</p>
                        <div className="mt-4 flex gap-3">
                          <button
                            type="button"
                            className="trellis-accent-button rounded-field border px-3 py-2 text-xs transition"
                            onClick={() => {
                              void moderate(post.id, "approved");
                            }}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="rounded-field border border-trellis-border px-3 py-2 text-xs text-trellis-text transition hover:border-trellis-accent/35"
                            onClick={() => {
                              void moderate(post.id, "rejected");
                            }}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      </section>
    </PublicLayout>
  );
}
