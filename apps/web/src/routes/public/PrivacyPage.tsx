import { PublicLayout } from "@/components/public/PublicLayout";
import { usePageMeta } from "@/hooks/usePageMeta";

export function PrivacyPage() {
  usePageMeta({
    title: "Privacy policy",
    description: "How Trellis handles account data, cloud features, and local-first desktop behavior.",
    pathname: "/privacy"
  });

  return (
    <PublicLayout>
      <section className="mx-auto w-full max-w-4xl px-6 py-16">
        <div className="trellis-panel rounded-panel border border-trellis-border px-6 py-8">
          <h1 className="font-display text-5xl text-trellis-text">Privacy</h1>
          <div className="mt-6 space-y-5 text-sm leading-7 text-trellis-muted">
            <p>Trellis is built to keep the line between local and cloud behavior explicit. Desktop-only workspaces and local-first flows stay on-device unless you sign in and turn on cloud sync.</p>
            <p>When you use hosted chat or web access, Trellis stores account, billing, preferences, chat/session metadata, Strands, graph links, and related product data in Supabase. Provider keys stay encrypted when saved to your account.</p>
            <p>We do not publish private chats or account-only content on the public site. The feature forum only exposes ideas after admin approval.</p>
            <p>This page is a launch-ready placeholder policy and should be reviewed with counsel before broad public release.</p>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
