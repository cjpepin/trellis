export interface SiteNavLink {
  label: string;
  href: string;
}

const siteUrl = import.meta.env.VITE_SITE_URL?.trim() || "https://trellis.local";
const supportEmail = import.meta.env.VITE_SUPPORT_EMAIL?.trim() || "support@example.com";
const macDownloadUrl = import.meta.env.VITE_DOWNLOAD_MAC_URL?.trim() || "#download-coming-soon";
const latestVersion = import.meta.env.VITE_DOWNLOAD_MAC_VERSION?.trim() || "Coming soon";

export const siteConfig = {
  name: "Trellis",
  siteUrl,
  supportEmail,
  macDownloadUrl,
  latestVersion,
  featureForumHref: "/forum",
  updatesHref: "/updates",
  downloadHref: "/download",
  signInHref: "/auth",
  appHref: "/app/chat",
  publicNav: [
    { label: "Download", href: "/download" },
    { label: "Updates", href: "/updates" },
    { label: "Feature forum", href: "/forum" },
    { label: "Support", href: "/support" }
  ] satisfies SiteNavLink[]
};

export function buildAbsoluteSiteUrl(pathname: string): string {
  return new URL(pathname, siteConfig.siteUrl).toString();
}
