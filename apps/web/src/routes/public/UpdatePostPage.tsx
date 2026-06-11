import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PublicLayout } from "@/components/public/PublicLayout";
import { RichTextRenderer } from "@/components/shared/RichTextRenderer";
import { usePageMeta } from "@/hooks/usePageMeta";
import { getUpdatePostBySlug, type UpdatePostRecord } from "@/lib/publicContent";

export function UpdatePostPage() {
  const { slug = "" } = useParams();
  const [post, setPost] = useState<UpdatePostRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  usePageMeta({
    title: post?.title ?? "Update",
    description: post?.summary ?? "Read a Trellis product update.",
    pathname: `/updates/${slug}`
  });

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setLoading(true);
      try {
        const nextPost = await getUpdatePostBySlug(slug);
        if (!cancelled) {
          setPost(nextPost);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : "Could not load that update.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <PublicLayout>
      <section className="mx-auto w-full max-w-4xl px-6 py-16">
        <Link to="/updates" className="text-sm text-trellis-muted transition hover:text-trellis-text">
          ← Back to updates
        </Link>
        <div className="mt-6 trellis-panel rounded-panel border border-trellis-border px-6 py-8">
          {loading ? (
            <p className="text-sm text-trellis-muted">Loading update…</p>
          ) : errorMessage ? (
            <p className="text-sm text-trellis-error">{errorMessage}</p>
          ) : post ? (
            <>
              <p className="text-xs uppercase tracking-[0.18em] text-trellis-faint">
                {post.published_at
                  ? new Date(post.published_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric"
                    })
                  : "Draft"}
              </p>
              <h1 className="mt-4 font-display text-5xl text-trellis-text">{post.title}</h1>
              <p className="mt-4 text-base leading-8 text-trellis-muted">{post.summary}</p>
              <div className="mt-8">
                <RichTextRenderer markdown={post.body_markdown} existingSlugs={[]} />
              </div>
            </>
          ) : (
            <div>
              <h1 className="font-display text-4xl text-trellis-text">Update not found</h1>
              <p className="mt-4 text-sm leading-7 text-trellis-muted">
                This update is either unpublished or the link is out of date.
              </p>
            </div>
          )}
        </div>
      </section>
    </PublicLayout>
  );
}
