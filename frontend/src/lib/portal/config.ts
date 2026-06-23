/** Calari Staff Portal — server config & cookie constants. */

/** Django backend base URL (no trailing slash). API paths live under `/api`. */
export const DJANGO_BASE = (process.env.DJANGO_API_URL || "https://portal.calarisolutions.com").replace(
  /\/+$/,
  "",
);

/** Where the Django REST API is mounted. */
export const DJANGO_API = `${DJANGO_BASE}/api`;

/** Next-domain httpOnly cookies that hold the bridged Django JWTs. */
export const ACCESS_COOKIE = "calari_access";
export const REFRESH_COOKIE = "calari_refresh";

/** Django's own cookie names (what its CookieJWTAuthentication reads). */
export const DJANGO_ACCESS_COOKIE = "access_token";
export const DJANGO_REFRESH_COOKIE = "refresh_token";

/** Lifetimes mirror SIMPLE_JWT (access 8h, refresh 7d). */
export const ACCESS_MAX_AGE = 60 * 60 * 8;
export const REFRESH_MAX_AGE = 60 * 60 * 24 * 7;

export const IS_PROD = process.env.NODE_ENV === "production";

/** Parse a single cookie value out of an array of Set-Cookie header strings. */
export function parseSetCookie(setCookies: string[], name: string): string | null {
  for (const raw of setCookies) {
    const first = raw.split(";", 1)[0]?.trim() ?? "";
    const eq = first.indexOf("=");
    if (eq === -1) continue;
    if (first.slice(0, eq).trim() === name) {
      return first.slice(eq + 1).trim();
    }
  }
  return null;
}
