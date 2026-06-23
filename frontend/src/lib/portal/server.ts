import "server-only";
import { cookies } from "next/headers";
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE,
  DJANGO_ACCESS_COOKIE,
  DJANGO_API,
  DJANGO_REFRESH_COOKIE,
  IS_PROD,
  parseSetCookie,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
} from "./config";

const baseCookie = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: IS_PROD,
  path: "/",
};

export async function getTokens(): Promise<{ access?: string; refresh?: string }> {
  const store = await cookies();
  return {
    access: store.get(ACCESS_COOKIE)?.value,
    refresh: store.get(REFRESH_COOKIE)?.value,
  };
}

export async function setTokens(tokens: { access?: string | null; refresh?: string | null }) {
  const store = await cookies();
  if (tokens.access) {
    store.set(ACCESS_COOKIE, tokens.access, { ...baseCookie, maxAge: ACCESS_MAX_AGE });
  }
  if (tokens.refresh) {
    store.set(REFRESH_COOKIE, tokens.refresh, { ...baseCookie, maxAge: REFRESH_MAX_AGE });
  }
}

export async function clearTokens() {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
}

/** Build the Cookie header Django expects (its CookieJWTAuthentication reads access_token). */
export function djangoCookieHeader(access?: string, refresh?: string): string {
  const parts: string[] = [];
  if (access) parts.push(`${DJANGO_ACCESS_COOKIE}=${access}`);
  if (refresh) parts.push(`${DJANGO_REFRESH_COOKIE}=${refresh}`);
  return parts.join("; ");
}

/**
 * Exchange the refresh token for a fresh access token. Persists rotated tokens
 * to the Next cookies and returns the new access token (or null on failure).
 */
export async function refreshAccess(refresh: string): Promise<string | null> {
  try {
    const res = await fetch(`${DJANGO_API}/token/refresh/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: djangoCookieHeader(undefined, refresh),
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const setCookies = res.headers.getSetCookie?.() ?? [];
    const newAccess = parseSetCookie(setCookies, DJANGO_ACCESS_COOKIE);
    const newRefresh = parseSetCookie(setCookies, DJANGO_REFRESH_COOKIE);
    await setTokens({ access: newAccess, refresh: newRefresh ?? refresh });
    return newAccess;
  } catch {
    return null;
  }
}

/**
 * Authenticate against Django and bridge its JWTs into the Next httpOnly cookies.
 * Returns the Django user object on success, or null on bad credentials.
 * Used by the unified login so a single sign-in serves both the portal and Builds.
 */
export async function portalLogin(
  usernameOrEmail: string,
  password: string,
): Promise<Record<string, unknown> | null> {
  let res: Response;
  try {
    res = await fetch(`${DJANGO_API}/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username_or_email: usernameOrEmail, password }),
      cache: "no-store",
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const setCookies = res.headers.getSetCookie?.() ?? [];
  const access = parseSetCookie(setCookies, DJANGO_ACCESS_COOKIE);
  const refresh = parseSetCookie(setCookies, DJANGO_REFRESH_COOKIE);
  if (access) await setTokens({ access, refresh });

  try {
    const data = (await res.json()) as { user?: Record<string, unknown> };
    return data.user ?? null;
  } catch {
    return null;
  }
}

/**
 * Authenticated server-side call to the Django API (for Builds server
 * components/actions that have moved off Prisma). Refresh-on-auth-challenge
 * works in server actions/route handlers; in read-only server components a
 * failed refresh surfaces as an error the caller can treat as logged-out.
 */
export async function djangoServerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { access, refresh } = await getTokens();
  const url = `${DJANGO_API}/${path.replace(/^\/+/, "")}`;
  const doFetch = (token?: string) =>
    fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers || {}), Cookie: djangoCookieHeader(token, refresh) },
      cache: "no-store",
      redirect: "manual",
    });
  const isAuthChallenge = (r: Response) =>
    r.status === 401 || (r.status >= 300 && r.status < 400 && (r.headers.get("location") || "").includes("/login"));

  let res = await doFetch(access);
  if (isAuthChallenge(res) && refresh) {
    const newAccess = await refreshAccess(refresh);
    if (newAccess) res = await doFetch(newAccess);
  }
  return res;
}

async function serverJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await djangoServerFetch(path, init);
  if (res.status === 204) return null as T;
  if (res.status >= 300) {
    let detail = `Django request failed (${res.status})`;
    try {
      const d = await res.json();
      detail = d.detail || d.error || JSON.stringify(d);
    } catch {
      /* keep default */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export const serverApi = {
  get: <T>(path: string) => serverJson<T>(path),
  post: <T>(path: string, body?: unknown) => serverJson<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) => serverJson<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  del: (path: string) => serverJson<void>(path, { method: "DELETE" }),
};

/**
 * Server-side fetch of the current portal user. Read-only (no refresh) — intended
 * for layout gating; the client shell loads/refreshes the user via the proxy.
 */
export async function getPortalUser() {
  const { access } = await getTokens();
  if (!access) return null;
  try {
    const res = await fetch(`${DJANGO_API}/auth/me/`, {
      headers: { Cookie: djangoCookieHeader(access) },
      cache: "no-store",
      redirect: "manual", // Django 302s to /login/ when unauthenticated
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
