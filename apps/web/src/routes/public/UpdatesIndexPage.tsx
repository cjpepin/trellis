import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PublicLayout } from "@/components/public/PublicLayout";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useSupabaseSessionState } from "@/hooks/useSupabaseSessionState";
import {
  deleteUpdatePost,
  listVisibleUpdatePosts,
  saveUpdatePost,
  slugifyPublicTitle,
  type UpdatePostRecord,
  type UpdatePostStatus
} from "@/lib/publicContent";

type EditorState = {
  id?: string;
  published_at?: string | null;
  title: string;
  slug: string;
  summary: string;
  body_markdown: string;
  status: UpdatePostStatus;
};

const EMPTY_EDITOR: EditorState = {
  title: "",
  slug: "",
  summary: "",
  body_markdown: "",
  status: "draft"
};

export function UpdatesIndexPage() {
  usePageMeta({
    title: "Updates",
    description: "Read product updates and release notes for Trellis.",
    pathname: "/updates"
  });

  const { isAdmin } = useSupabaseSessionState();
  const [posts, setPosts] = useState<UpdatePostRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function loadPosts(): Promise<void> {
    setLoading(true);
    try {
      setPosts(await listVisibleUpdatePosts());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not load updates.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPosts();
  }, []);

  function startEditing(post?: UpdatePostRecord): void {
    if (!post) {
      setEditor(EMPTY_EDITOR);
      return;
    }

    setEditor({
      id: post.id,
      published_at: post.published_at,
      title: post.title,
      slug: post.slug,
      summary: post.summary,
      body_markdown: post.body_markdown,
      status: post.status
    });
  }

  async function handleSave(): Promise<void> {
    if (!editor.title.trim() || !editor.summary.trim() || !editor.body_markdown.trim()) {
      setErrorMessage("Title, summary, and body are all required.");
      return;
    }

    const slug = editor.slug.trim() || slugifyPublicTitle(editor.title);

    try {
      await saveUpdatePost({
        id: editor.id,
        published_at: editor.published_at ?? undefined,
        title: editor.title.trim(),
        slug,
        summary: editor.summary.trim(),
        body_markdown: editor.body_markdown.trim(),
        status: editor.status
      });
      setStatusMessage("Update saved.");
      setErrorMessage(null);
      setEditor(EMPTY_EDITOR);
      await loadPosts();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not save that update.");
    }
  }

  async function handleDelete(id: string): Promise<void> {
    try {
      await deleteUpdatePost(id);
      if (editor.id === id) {
        setEditor(EMPTY_EDITOR);
      }
      setStatusMessage("Update removed.");
      setErrorMessage(null);
      await loadPosts();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not delete that update.");
    }
  }

  return (
    <PublicLayout>
      <section className="mx-auto w-full max-w-6xl px-6 py-16">
        <div className="mb-8">
          <h1 className="font-display text-5xl text-trellis-text">Updates</h1>
          <p className="mt-4 max-w-3xl text-base leading-8 text-trellis-muted">
            Release notes, shipping progress, and launch updates live here. Public visitors only see published posts.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <div className="space-y-4">
            {loading ? (
              <div className="trellis-panel rounded-panel border border-trellis-border px-5 py-5 text-sm text-trellis-muted">
                Loading updates…
              </div>
            ) : posts.length > 0 ? (
              posts.map((post) => (
                <article key={post.id} className="trellis-panel rounded-panel border border-trellis-border px-5 py-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Link to={`/updates/${post.slug}`} className="font-display text-3xl text-trellis-text transition hover:text-trellis-accent">
                        {post.title}
                      </Link>
                      <p className="mt-2 text-sm leading-7 text-trellis-muted">{post.summary}</p>
                    </div>
                    <span className="text-[11px] uppercase tracking-[0.14em] text-trellis-faint">
                      {post.status}
                    </span>
                  </div>
                  <p className="mt-4 text-xs text-trellis-faint">
                    {post.published_at
                      ? new Date(post.published_at).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric"
                        })
                      : "Not published yet"}
                  </p>
                  {isAdmin && (
                    <div className="mt-4 flex gap-3">
                      <button
                        type="button"
                        className="rounded-field border border-trellis-border px-3 py-2 text-xs text-trellis-text transition hover:border-trellis-accent/35"
                        onClick={() => startEditing(post)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="rounded-field border border-trellis-border px-3 py-2 text-xs text-trellis-text transition hover:border-trellis-accent/35"
                        onClick={() => {
                          void handleDelete(post.id);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </article>
              ))
            ) : (
              <div className="trellis-panel rounded-panel border border-dashed border-trellis-border px-5 py-5 text-sm text-trellis-muted">
                No published updates yet.
              </div>
            )}
          </div>

          {isAdmin && (
            <aside className="trellis-elevated rounded-panel border border-trellis-border bg-trellis-surface/90 px-5 py-5">
              <div className="flex items-center justify-between gap-3">
                <p className="font-display text-3xl text-trellis-text">Admin editor</p>
                <button
                  type="button"
                  className="rounded-field border border-trellis-border px-3 py-2 text-xs text-trellis-text transition hover:border-trellis-accent/35"
                  onClick={() => startEditing()}
                >
                  New post
                </button>
              </div>
              <div className="mt-4 grid gap-3">
                <input
                  value={editor.title}
                  onChange={(event) => {
                    const title = event.target.value;
                    setEditor((current) => ({
                      ...current,
                      title,
                      slug: current.id ? current.slug : slugifyPublicTitle(title)
                    }));
                  }}
                  className="trellis-input"
                  placeholder="Post title"
                />
                <input
                  value={editor.slug}
                  onChange={(event) => setEditor((current) => ({ ...current, slug: event.target.value }))}
                  className="trellis-input"
                  placeholder="post-slug"
                />
                <textarea
                  value={editor.summary}
                  onChange={(event) => setEditor((current) => ({ ...current, summary: event.target.value }))}
                  className="trellis-input min-h-[110px] resize-y py-3"
                  placeholder="Short summary"
                />
                <textarea
                  value={editor.body_markdown}
                  onChange={(event) => setEditor((current) => ({ ...current, body_markdown: event.target.value }))}
                  className="trellis-input min-h-[240px] resize-y py-3 font-mono text-xs"
                  placeholder="Markdown body"
                />
                <select
                  value={editor.status}
                  onChange={(event) => setEditor((current) => ({ ...current, status: event.target.value as UpdatePostStatus }))}
                  className="trellis-input"
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                </select>
                <button
                  type="button"
                  className="trellis-accent-button rounded-field border px-4 py-3 text-sm transition"
                  onClick={() => {
                    void handleSave();
                  }}
                >
                  Save post
                </button>
              </div>
              {statusMessage && <p className="mt-3 text-xs text-trellis-success">{statusMessage}</p>}
              {errorMessage && <p className="mt-3 text-xs text-trellis-error">{errorMessage}</p>}
            </aside>
          )}
        </div>
      </section>
    </PublicLayout>
  );
}
