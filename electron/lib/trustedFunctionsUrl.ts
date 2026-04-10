/**
 * Ensures cloud extraction calls only target this build's Supabase Functions origin
 * (mitigates tampered local job rows pointing exfil endpoints).
 */
export function getExpectedFunctionsBaseUrl(): string | null {
  const base = process.env.VITE_SUPABASE_URL?.trim();

  if (!base) {
    return null;
  }

  return `${base.replace(/\/$/, "")}/functions/v1`;
}

function stripTrailingSlash(pathname: string): string {
  if (pathname === "/") {
    return "/";
  }

  return pathname.replace(/\/$/, "");
}

export function isTrustedFunctionsBaseUrl(url: string): boolean {
  const expected = getExpectedFunctionsBaseUrl();

  if (!expected) {
    return false;
  }

  try {
    const parsed = new URL(url);
    const exp = new URL(expected);

    return (
      parsed.protocol === exp.protocol &&
      parsed.host === exp.host &&
      stripTrailingSlash(parsed.pathname) === stripTrailingSlash(exp.pathname)
    );
  } catch {
    return false;
  }
}
