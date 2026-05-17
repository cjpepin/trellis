import { PublicLayout } from "@/components/public/PublicLayout";
import { usePageMeta } from "@/hooks/usePageMeta";

export function TermsPage() {
  usePageMeta({
    title: "Terms and desktop use",
    description: "Basic launch terms for using Trellis across the hosted site and Mac desktop app.",
    pathname: "/terms"
  });

  return (
    <PublicLayout>
      <section className="mx-auto w-full max-w-4xl px-6 py-16">
        <div className="trellis-panel rounded-panel border border-trellis-border px-6 py-8">
          <h1 className="font-display text-5xl text-trellis-text">Terms</h1>
          <div className="mt-6 space-y-5 text-sm leading-7 text-trellis-muted">
            <p>Trellis is provided as software for personal and team knowledge work. You are responsible for the content you store, the provider keys you connect, and any exported files you distribute.</p>
            <p>The hosted site, forum, and updates pages may change as the product matures. We may suspend abusive usage, especially around automated spam, credential misuse, or attempts to bypass published limits.</p>
            <p>The Mac download placeholder on this site should be replaced with your real signed artifact and final EULA language before general availability.</p>
            <p>This page is a launch-ready placeholder and should be finalized with legal review before a public launch.</p>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
