import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import pdfParse from "pdf-parse";
import { ipcMain } from "electron";
import { z } from "zod";
import type { AppSettings } from "./types";
import { ipcChannels } from "./types";
import { saveRawSource } from "./vault";

const parsePdfSchema = z.object({
  fileName: z.string().min(1),
  bytes: z.array(z.number().int().min(0).max(255))
});

const clipUrlSchema = z.object({
  url: z.string().url()
});
const clipProtocols = new Set(["http:", "https:"]);
const maxClipRedirects = 5;
const maxClipBytes = 2_000_000;

async function extractArticleContent(
  html: string,
  url: string
): Promise<{ title: string; content: string }> {
  const [{ JSDOM }, { Readability }] = await Promise.all([
    import("jsdom"),
    import("@mozilla/readability")
  ]);
  const document = new JSDOM(html, { url });
  const article = new Readability(document.window.document).parse();

  if (!article?.textContent) {
    throw new Error("Could not extract readable content from that page.");
  }

  return {
    title: article.title || "Untitled Article",
    content: article.textContent.trim()
  };
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();

  if (normalized === "::" || normalized === "::1" || normalized.startsWith("fe80:")) {
    return true;
  }

  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }

  const mappedIpv4Prefix = "::ffff:";

  if (normalized.startsWith(mappedIpv4Prefix)) {
    return isPrivateAddress(normalized.slice(mappedIpv4Prefix.length));
  }

  if (isIP(address) !== 4) {
    return false;
  }

  const octets = address.split(".").map((part) => Number(part));
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127)
  );
}

function assertAllowedClipUrl(url: URL): void {
  if (!clipProtocols.has(url.protocol)) {
    throw new Error("Web clipping only supports http and https URLs.");
  }

  if (url.username || url.password) {
    throw new Error("Web clipping does not support URLs with embedded credentials.");
  }

  const hostname = url.hostname.toLowerCase();

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    isPrivateAddress(hostname)
  ) {
    throw new Error("Web clipping only supports public web URLs.");
  }
}

async function assertPublicHostname(url: URL): Promise<void> {
  assertAllowedClipUrl(url);

  try {
    const records = await lookup(url.hostname, {
      all: true,
      verbatim: true
    });

    if (records.length === 0 || records.some((record) => isPrivateAddress(record.address))) {
      throw new Error("Web clipping only supports public web URLs.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("public web URLs")) {
      throw error;
    }

    throw new Error("Could not resolve that URL.");
  }
}

async function fetchClipHtml(startingUrl: URL): Promise<{ html: string; finalUrl: string }> {
  let currentUrl = startingUrl;

  for (let redirectCount = 0; redirectCount <= maxClipRedirects; redirectCount += 1) {
    await assertPublicHostname(currentUrl);

    const response = await fetch(currentUrl, {
      redirect: "manual",
      headers: {
        Accept: "text/html,application/xhtml+xml"
      }
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");

      if (!location) {
        throw new Error("That page redirected without a destination URL.");
      }

      currentUrl = new URL(location, currentUrl);
      continue;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch ${currentUrl.toString()}`);
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

    if (
      contentType.length > 0 &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      throw new Error("Please clip a web page instead of a file download.");
    }

    const contentLength = Number(response.headers.get("content-length") ?? "0");

    if (Number.isFinite(contentLength) && contentLength > maxClipBytes) {
      throw new Error("That page is too large to clip safely.");
    }

    const html = await response.text();

    if (html.length > maxClipBytes) {
      throw new Error("That page is too large to clip safely.");
    }

    return {
      html,
      finalUrl: currentUrl.toString()
    };
  }

  throw new Error("Too many redirects while clipping that URL.");
}

export function registerIngestIpc(getSettings: () => AppSettings): void {
  ipcMain.handle(ipcChannels.ingestParsePdf, async (_event, input: unknown) => {
    const parsed = parsePdfSchema.parse(input);
    const bytes = Uint8Array.from(parsed.bytes);
    const settings = getSettings();
    const activeVault =
      settings.vaults.find((vault) => vault.id === settings.activeVaultId) ?? settings.vaults[0];

    if (!activeVault) {
      throw new Error("Trellis needs at least one configured vault.");
    }

    const sourcePath = await saveRawSource(activeVault.path, parsed.fileName, bytes);
    const pdf = await pdfParse(Buffer.from(bytes));

    return {
      title: parsed.fileName.replace(/\.pdf$/i, ""),
      content: pdf.text.trim(),
      sourcePath,
      sourceType: "pdf" as const
    };
  });

  ipcMain.handle(ipcChannels.ingestClipUrl, async (_event, input: unknown) => {
    const parsed = clipUrlSchema.parse(input);
    const startingUrl = new URL(parsed.url);
    const { html, finalUrl } = await fetchClipHtml(startingUrl);
    const article = await extractArticleContent(html, finalUrl);

    return {
      title: article.title,
      content: article.content,
      sourcePath: finalUrl,
      sourceType: "web" as const
    };
  });
}
