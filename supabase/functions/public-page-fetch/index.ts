import { corsHeaders } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { assertMaxJsonBodyBytes, readJsonBodyWithByteLimit } from "../_shared/requestLimits.ts";

const clipProtocols = new Set(["http:", "https:"]);
const maxClipRedirects = 5;
const maxClipBytes = 2_000_000;

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === undefined || b === undefined) {
    return true;
  }
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isPrivateIpString(address: string): boolean {
  const normalized = address.toLowerCase().trim();
  if (normalized === "::" || normalized === "::1" || normalized.startsWith("fe80:")) {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(normalized);
  if (v4) {
    const octets = [v4[1], v4[2], v4[3], v4[4]].map((x) => Number(x));
    if (octets.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
      return true;
    }
    return isPrivateIpv4(octets as number[]);
  }
  return false;
}

function assertAllowedClipUrl(url: URL): void {
  if (!clipProtocols.has(url.protocol)) {
    throw new Response(
      JSON.stringify({ error: "Only http and https URLs are supported." }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }

  if (url.username || url.password) {
    throw new Response(
      JSON.stringify({ error: "URLs with embedded credentials are not supported." }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }

  const hostname = url.hostname.toLowerCase();

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    isPrivateIpString(hostname)
  ) {
    throw new Response(
      JSON.stringify({ error: "Only public web URLs can be fetched." }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
}

function flattenDnsRecords(records: unknown): string[] {
  if (!Array.isArray(records)) {
    return [];
  }
  const ips: string[] = [];
  for (const r of records) {
    if (typeof r === "string") {
      ips.push(r);
      continue;
    }
    if (r && typeof r === "object") {
      const o = r as Record<string, unknown>;
      if (typeof o.address === "string") {
        ips.push(o.address);
      }
      if (typeof o.target === "string") {
        ips.push(o.target);
      }
    }
  }
  return ips;
}

async function assertPublicHostname(hostname: string): Promise<void> {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (v4) {
    const octets = [v4[1], v4[2], v4[3], v4[4]].map((x) => Number(x));
    if (octets.some((n) => !Number.isFinite(n) || n < 0 || n > 255) || isPrivateIpv4(octets)) {
      throw new Response(
        JSON.stringify({ error: "Only public web URLs can be fetched." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }
    return;
  }

  assertAllowedClipUrl(new URL(`https://${hostname}`));

  const resolveRecords = async (recordType: "A" | "AAAA"): Promise<string[]> => {
    try {
      const out = await Deno.resolveDns(hostname, recordType);
      return flattenDnsRecords(out);
    } catch {
      return [];
    }
  };

  const a = await resolveRecords("A");
  const aaaa = await resolveRecords("AAAA");
  const all = [...a, ...aaaa];

  if (all.length === 0) {
    throw new Response(
      JSON.stringify({ error: "Could not resolve that hostname." }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }

  for (const ip of all) {
    if (isPrivateIpString(ip)) {
      throw new Response(
        JSON.stringify({ error: "Only public web URLs can be fetched." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }
  }
}

async function fetchClipHtml(startingUrl: URL): Promise<{ html: string; finalUrl: string }> {
  let currentUrl = startingUrl;

  for (let redirectCount = 0; redirectCount <= maxClipRedirects; redirectCount += 1) {
    await assertPublicHostname(currentUrl.hostname);

    const response = await fetch(currentUrl.toString(), {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "TrellisPublicPageFetch/1.0"
      },
      redirect: "manual"
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Response(
          JSON.stringify({ error: "Redirect without a destination URL." }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          }
        );
      }
      currentUrl = new URL(location, currentUrl);
      assertAllowedClipUrl(currentUrl);
      continue;
    }

    if (!response.ok) {
      throw new Response(
        JSON.stringify({ error: `Failed to fetch page (${response.status}).` }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

    if (
      contentType.length > 0 &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      throw new Response(
        JSON.stringify({ error: "URL must point to an HTML page, not a file download." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    const contentLength = Number(response.headers.get("content-length") ?? "0");

    if (Number.isFinite(contentLength) && contentLength > maxClipBytes) {
      throw new Response(
        JSON.stringify({ error: "That page is too large to clip safely." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    const html = await response.text();

    if (html.length > maxClipBytes) {
      throw new Response(
        JSON.stringify({ error: "That page is too large to clip safely." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    return {
      html,
      finalUrl: currentUrl.toString()
    };
  }

  throw new Response(
    JSON.stringify({ error: "Too many redirects while fetching that page." }),
    {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    }
  );
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    assertMaxJsonBodyBytes(request);
    await requireUser(request);

    const body = (await readJsonBodyWithByteLimit(request)) as Record<string, unknown>;
    const rawUrl = typeof body.url === "string" ? body.url.trim() : "";

    if (rawUrl.length < 8) {
      throw new Response(JSON.stringify({ error: "Missing url." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    let startingUrl: URL;
    try {
      startingUrl = new URL(rawUrl);
    } catch {
      throw new Response(JSON.stringify({ error: "Invalid URL." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    assertAllowedClipUrl(startingUrl);
    const { html, finalUrl } = await fetchClipHtml(startingUrl);

    return new Response(JSON.stringify({ html, finalUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Fetch failed."
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
