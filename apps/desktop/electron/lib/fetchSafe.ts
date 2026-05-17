import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

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

/**
 * HTTPS GET that resolves the hostname once and connects to the chosen public address,
 * mitigating DNS rebinding between preflight and the TCP connection.
 */
export async function fetchSafeHttps(
  urlString: string,
  init?: { headers?: Record<string, string> }
): Promise<Response> {
  const url = new URL(urlString);
  if (url.protocol !== "https:") {
    throw new Error("fetchSafeHttps only supports https URLs.");
  }

  const records = await lookup(url.hostname, { all: true, verbatim: true });
  const chosen = records.find((r) => !isPrivateAddress(r.address));

  if (!chosen) {
    throw new Error("No public address resolved for host.");
  }

  const isV6 = chosen.family === 6;
  const hostHeader = url.hostname;
  const pathQuery = `${url.pathname}${url.search}`;

  return await new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: isV6 ? `[${chosen.address}]` : chosen.address,
        servername: hostHeader,
        port: url.port ? Number(url.port) : 443,
        method: "GET",
        path: pathQuery,
        headers: {
          Host: hostHeader,
          Accept: init?.headers?.Accept ?? "*/*",
          ...init?.headers
        },
        rejectUnauthorized: true
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (c: Buffer) => chunks.push(c));
        incoming.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve(
            new Response(body, {
              status: incoming.statusCode ?? 0,
              headers: incoming.headers as HeadersInit
            })
          );
        });
        incoming.on("error", reject);
      }
    );
    req.on("error", reject);
    req.end();
  });
}

const fetchSafePostAllowedHosts = new Set(["api.openai.com", "api.anthropic.com"]);

/**
 * HTTPS POST with JSON body to an allowlisted API host. Uses the same DNS pinning pattern as GET.
 */
const defaultHttpsPostTimeoutMs = 90_000;

export async function fetchSafeHttpsPost(
  urlString: string,
  init: {
    headers?: Record<string, string>;
    body: string;
    /** Wall-clock limit for the full request (DNS + TLS + response body). Default 90s. */
    timeoutMs?: number;
  }
): Promise<Response> {
  const url = new URL(urlString);
  if (url.protocol !== "https:") {
    throw new Error("fetchSafeHttpsPost only supports https URLs.");
  }

  if (!fetchSafePostAllowedHosts.has(url.hostname)) {
    throw new Error("fetchSafeHttpsPost host is not allowlisted.");
  }

  const records = await lookup(url.hostname, { all: true, verbatim: true });
  const chosen = records.find((r) => !isPrivateAddress(r.address));

  if (!chosen) {
    throw new Error("No public address resolved for host.");
  }

  const isV6 = chosen.family === 6;
  const hostHeader = url.hostname;
  const pathQuery = `${url.pathname}${url.search}`;
  const bodyBuffer = Buffer.from(init.body, "utf8");
  const timeoutMs = init.timeoutMs ?? defaultHttpsPostTimeoutMs;
  const signal = AbortSignal.timeout(Math.max(1000, timeoutMs));

  return await new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error(`Request timed out after ${timeoutMs}ms.`));
      return;
    }

    const req = httpsRequest(
      {
        host: isV6 ? `[${chosen.address}]` : chosen.address,
        servername: hostHeader,
        port: url.port ? Number(url.port) : 443,
        method: "POST",
        path: pathQuery,
        headers: {
          Host: hostHeader,
          "Content-Type": "application/json",
          "Content-Length": String(bodyBuffer.length),
          ...init.headers
        },
        rejectUnauthorized: true,
        signal
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (c: Buffer) => chunks.push(c));
        incoming.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve(
            new Response(body, {
              status: incoming.statusCode ?? 0,
              headers: incoming.headers as HeadersInit
            })
          );
        });
        incoming.on("error", reject);
      }
    );
    req.on("error", reject);
    req.write(bodyBuffer);
    req.end();
  });
}
