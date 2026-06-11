import { PublicLayout } from "@/components/public/PublicLayout";
import { usePageMeta } from "@/hooks/usePageMeta";
import { siteConfig } from "@/lib/siteConfig";

export function DownloadPage() {
  usePageMeta({
    title: "Download for Mac",
    description: "Download the Mac desktop build of Trellis and keep local capture close at hand.",
    pathname: "/download"
  });

  const isPlaceholder = siteConfig.macDownloadUrl.startsWith("#");

  return (
    <PublicLayout>
      <section className="mx-auto w-full max-w-4xl px-6 py-16">
        <div className="trellis-elevated rounded-panel border border-trellis-border bg-trellis-surface/90 px-6 py-8">
          <p className="text-xs uppercase tracking-[0.18em] text-trellis-faint">Mac desktop</p>
          <h1 className="mt-4 font-display text-5xl text-trellis-text">Download Trellis for macOS</h1>
          <p className="mt-4 max-w-2xl text-base leading-8 text-trellis-muted">
            The Mac app is the primary desktop surface today. This page is wired so you can swap in
            a signed artifact URL later without rebuilding the rest of the site.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <a
              href={siteConfig.macDownloadUrl}
              className="trellis-accent-button rounded-field border px-5 py-3 text-sm transition"
            >
              {isPlaceholder ? "Download coming soon" : "Download for Mac"}
            </a>
            <p className="text-sm text-trellis-muted">Latest desktop version: {siteConfig.latestVersion}</p>
          </div>
          <div className="mt-8 rounded-panel border border-dashed border-trellis-border px-4 py-4 text-sm leading-7 text-trellis-muted">
            When your signed build is ready, set `VITE_DOWNLOAD_MAC_URL` and `VITE_DOWNLOAD_MAC_VERSION`
            for the hosted web build. The page will automatically switch from placeholder copy to a
            live artifact link.
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
