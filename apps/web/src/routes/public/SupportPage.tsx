import { PublicLayout } from "@/components/public/PublicLayout";
import { usePageMeta } from "@/hooks/usePageMeta";
import { siteConfig } from "@/lib/siteConfig";

export function SupportPage() {
  usePageMeta({
    title: "Support",
    description: "Contact and support information for the hosted Trellis experience and Mac app.",
    pathname: "/support"
  });

  return (
    <PublicLayout>
      <section className="mx-auto w-full max-w-4xl px-6 py-16">
        <div className="trellis-panel rounded-panel border border-trellis-border px-6 py-8">
          <h1 className="font-display text-5xl text-trellis-text">Support</h1>
          <p className="mt-4 text-sm leading-7 text-trellis-muted">
            Use the feature forum for product ideas and roadmap feedback. For account, billing, or
            access issues, contact the support address below.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <a href={`mailto:${siteConfig.supportEmail}`} className="trellis-elevated rounded-panel border border-trellis-border px-5 py-5 transition hover:border-trellis-accent/35">
              <p className="text-xs uppercase tracking-[0.16em] text-trellis-faint">Email</p>
              <p className="mt-2 font-display text-2xl text-trellis-text">{siteConfig.supportEmail}</p>
            </a>
            <div className="trellis-elevated rounded-panel border border-trellis-border px-5 py-5">
              <p className="text-xs uppercase tracking-[0.16em] text-trellis-faint">Response expectations</p>
              <p className="mt-2 text-sm leading-7 text-trellis-muted">
                Keep this copy simple at launch: define your response SLA, billing contact process,
                and the support hours you actually plan to maintain.
              </p>
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
