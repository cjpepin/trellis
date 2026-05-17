import { Link } from "react-router-dom";
import { PublicLayout } from "@/components/public/PublicLayout";
import { usePageMeta } from "@/hooks/usePageMeta";
import { siteConfig } from "@/lib/siteConfig";

export function NotFoundPage() {
  usePageMeta({
    title: "Page not found",
    description: "The page you requested does not exist on the hosted Trellis site.",
    pathname: "/404"
  });

  return (
    <PublicLayout>
      <section className="mx-auto flex min-h-[60vh] w-full max-w-4xl items-center px-6 py-16">
        <div className="trellis-elevated w-full rounded-panel border border-trellis-border px-6 py-10 text-center">
          <p className="text-xs uppercase tracking-[0.18em] text-trellis-faint">404</p>
          <h1 className="mt-4 font-display text-5xl text-trellis-text">This page lost its thread.</h1>
          <p className="mt-4 text-sm leading-7 text-trellis-muted">
            The URL may have changed while the production web surface was taking shape.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/" className="trellis-accent-button rounded-field border px-5 py-3 text-sm transition">
              Back home
            </Link>
            <Link to={siteConfig.appHref} className="rounded-field border border-trellis-border px-5 py-3 text-sm text-trellis-text transition hover:border-trellis-accent/35">
              Open app
            </Link>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
