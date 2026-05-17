import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { appShellPath } from "@/lib/appRoutes";
import { useSupabaseSessionState } from "@/hooks/useSupabaseSessionState";
import { siteConfig } from "@/lib/siteConfig";

interface Props {
  children: ReactNode;
}

export function PublicLayout({ children }: Props) {
  const { session, isAnonymousUser } = useSupabaseSessionState();
  const accountCta = session && !isAnonymousUser ? appShellPath("/chat") : siteConfig.signInHref;
  const accountLabel = session && !isAnonymousUser ? "Open app" : "Sign in";

  return (
    <div className="min-h-screen bg-trellis-bg text-trellis-text">
      <header className="border-b border-trellis-border bg-trellis-bg/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <Link to="/" className="font-display text-2xl text-trellis-text">
            {siteConfig.name}
          </Link>
          <nav className="hidden items-center gap-5 text-sm text-trellis-muted md:flex">
            {siteConfig.publicNav.map((item) => (
              <Link key={item.href} to={item.href} className="transition hover:text-trellis-text">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <Link
              to={siteConfig.downloadHref}
              className="rounded-field border border-trellis-border px-3 py-2 text-sm text-trellis-text transition hover:border-trellis-accent/35"
            >
              Download for Mac
            </Link>
            <Link
              to={accountCta}
              className="trellis-accent-button rounded-field border px-3 py-2 text-sm transition"
            >
              {accountLabel}
            </Link>
          </div>
        </div>
      </header>
      <main>{children}</main>
      <footer className="border-t border-trellis-border bg-trellis-sidebar/70">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-8 text-sm text-trellis-muted md:flex-row md:items-center md:justify-between">
          <p>AI conversations that compound into living knowledge.</p>
          <div className="flex flex-wrap items-center gap-4">
            <Link to="/privacy" className="transition hover:text-trellis-text">
              Privacy
            </Link>
            <Link to="/terms" className="transition hover:text-trellis-text">
              Terms
            </Link>
            <Link to="/support" className="transition hover:text-trellis-text">
              Support
            </Link>
            <a href={`mailto:${siteConfig.supportEmail}`} className="transition hover:text-trellis-text">
              {siteConfig.supportEmail}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
