import { Link } from "react-router-dom";
import { PublicLayout } from "@/components/public/PublicLayout";
import { usePageMeta } from "@/hooks/usePageMeta";
import { siteConfig } from "@/lib/siteConfig";

const featureHighlights = [
  {
    title: "Chat that compounds",
    body: "Each useful conversation can turn into durable Strands instead of disappearing into a transcript."
  },
  {
    title: "Interlinked Strands",
    body: "Your notes, sessions, and graph stay connected so you can revisit an idea from multiple angles."
  },
  {
    title: "Desktop-first capture",
    body: "Trellis keeps the Mac app close at hand while the hosted web experience makes the product discoverable."
  }
];

const screenshotCards = [
  "Chat session with extraction suggestions",
  "Strands view with linked notes and revisions",
  "Knowledge graph spotlighting connected ideas"
];

export function LandingPage() {
  usePageMeta({
    title: "AI knowledge that keeps taking root",
    description:
      "Trellis turns AI conversations into durable, linked knowledge across chat, Strands, and graph views.",
    pathname: "/"
  });

  return (
    <PublicLayout>
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-14 md:flex-row md:items-center md:py-20">
        <div className="max-w-3xl flex-1">
          <p className="text-xs uppercase tracking-[0.18em] text-trellis-faint">Production preview</p>
          <h1 className="mt-4 font-display text-5xl leading-tight text-trellis-text md:text-6xl">
            AI conversations that turn into a living knowledge system.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-trellis-muted">
            Trellis gives you a calm place to think: chat, shape durable Strands, and explore the
            connections in a graph instead of losing ideas in a scrollback log.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to={siteConfig.appHref} className="trellis-accent-button rounded-field border px-5 py-3 text-sm transition">
              Try the web app
            </Link>
            <Link to={siteConfig.downloadHref} className="rounded-field border border-trellis-border px-5 py-3 text-sm text-trellis-text transition hover:border-trellis-accent/35">
              Download for Mac
            </Link>
            <Link to={siteConfig.featureForumHref} className="rounded-field border border-trellis-border px-5 py-3 text-sm text-trellis-text transition hover:border-trellis-accent/35">
              Request a feature
            </Link>
          </div>
        </div>
        <div className="grid flex-1 gap-4">
          {screenshotCards.map((card) => (
            <div key={card} className="trellis-elevated min-h-[150px] rounded-panel border border-trellis-border bg-trellis-surface/90 p-5">
              <p className="text-[11px] uppercase tracking-[0.16em] text-trellis-faint">Screenshot placeholder</p>
              <p className="mt-5 font-display text-2xl text-trellis-text">{card}</p>
              <p className="mt-2 text-sm leading-6 text-trellis-muted">
                Replace this card with a real screenshot or GIF when the production capture set is ready.
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-6xl gap-6 px-6 pb-8 md:grid-cols-3">
        {featureHighlights.map((item) => (
          <article key={item.title} className="trellis-panel rounded-panel border border-trellis-border bg-trellis-surface/80 px-5 py-5">
            <h2 className="font-display text-2xl text-trellis-text">{item.title}</h2>
            <p className="mt-3 text-sm leading-7 text-trellis-muted">{item.body}</p>
          </article>
        ))}
      </section>

      <section className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-8 md:grid-cols-4">
        <Link to={siteConfig.signInHref} className="trellis-panel rounded-panel border border-trellis-border px-5 py-5 transition hover:border-trellis-accent/35">
          <p className="font-display text-2xl text-trellis-text">Sign in</p>
          <p className="mt-2 text-sm leading-6 text-trellis-muted">Resume your account, or create one when you are ready to keep your work.</p>
        </Link>
        <Link to={siteConfig.downloadHref} className="trellis-panel rounded-panel border border-trellis-border px-5 py-5 transition hover:border-trellis-accent/35">
          <p className="font-display text-2xl text-trellis-text">Mac download</p>
          <p className="mt-2 text-sm leading-6 text-trellis-muted">Desktop capture is the primary local-first surface today.</p>
        </Link>
        <Link to={siteConfig.updatesHref} className="trellis-panel rounded-panel border border-trellis-border px-5 py-5 transition hover:border-trellis-accent/35">
          <p className="font-display text-2xl text-trellis-text">Updates</p>
          <p className="mt-2 text-sm leading-6 text-trellis-muted">Read product notes, release announcements, and launch progress in one place.</p>
        </Link>
        <Link to={siteConfig.featureForumHref} className="trellis-panel rounded-panel border border-trellis-border px-5 py-5 transition hover:border-trellis-accent/35">
          <p className="font-display text-2xl text-trellis-text">Feature forum</p>
          <p className="mt-2 text-sm leading-6 text-trellis-muted">Submit ideas, then let approved requests surface publicly for everyone else to see.</p>
        </Link>
      </section>
    </PublicLayout>
  );
}
