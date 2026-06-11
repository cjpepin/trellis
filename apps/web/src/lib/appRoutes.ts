import { usesTrellisHashRouter } from "./platform/runtime";

export const WEB_APP_BASE_PATH = "/app";

export function appShellPath(path: `/${string}`): string {
  if (usesTrellisHashRouter()) {
    return path;
  }

  if (path === "/") {
    return WEB_APP_BASE_PATH;
  }

  return `${WEB_APP_BASE_PATH}${path}`;
}

export function stripAppShellBase(pathname: string): string {
  if (!pathname.startsWith(WEB_APP_BASE_PATH)) {
    return pathname || "/";
  }

  const stripped = pathname.slice(WEB_APP_BASE_PATH.length);
  return stripped.length > 0 ? stripped : "/";
}

export function isAppShellPath(pathname: string): boolean {
  return pathname === WEB_APP_BASE_PATH || pathname.startsWith(`${WEB_APP_BASE_PATH}/`);
}
