import { useEffect } from "react";
import { buildAbsoluteSiteUrl, siteConfig } from "@/lib/siteConfig";

interface PageMetaInput {
  title: string;
  description: string;
  pathname: string;
}

function setMetaTag(selector: string, attribute: "content" | "href", value: string): void {
  let element = document.head.querySelector<HTMLMetaElement | HTMLLinkElement>(selector);

  if (!element) {
    const created = selector.startsWith("link")
      ? document.createElement("link")
      : document.createElement("meta");

    if (selector.includes('rel="canonical"') && created instanceof HTMLLinkElement) {
      created.rel = "canonical";
    }
    if (selector.includes('name="description"') && created instanceof HTMLMetaElement) {
      created.name = "description";
    }
    if (selector.includes('property="og:title"') && created instanceof HTMLMetaElement) {
      created.setAttribute("property", "og:title");
    }
    if (selector.includes('property="og:description"') && created instanceof HTMLMetaElement) {
      created.setAttribute("property", "og:description");
    }
    if (selector.includes('property="og:url"') && created instanceof HTMLMetaElement) {
      created.setAttribute("property", "og:url");
    }

    document.head.appendChild(created);
    element = created;
  }

  element.setAttribute(attribute, value);
}

export function usePageMeta({ title, description, pathname }: PageMetaInput): void {
  useEffect(() => {
    document.title = `${title} · ${siteConfig.name}`;
    setMetaTag('meta[name="description"]', "content", description);
    setMetaTag('meta[property="og:title"]', "content", `${title} · ${siteConfig.name}`);
    setMetaTag('meta[property="og:description"]', "content", description);
    setMetaTag('meta[property="og:url"]', "content", buildAbsoluteSiteUrl(pathname));
    setMetaTag('link[rel="canonical"]', "href", buildAbsoluteSiteUrl(pathname));
  }, [description, pathname, title]);
}
