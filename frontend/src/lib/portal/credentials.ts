import { DJANGO_API } from "./config";

/**
 * Validate credentials against Django and return its user object (or null).
 * Cookie-free / next/headers-free so it is safe to import from the NextAuth
 * config (which is reachable from middleware). Cookie bridging is done
 * separately by `portalLogin` in the login action.
 */
export async function verifyDjangoCredentials(
  usernameOrEmail: string,
  password: string,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${DJANGO_API}/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username_or_email: usernameOrEmail, password }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: Record<string, unknown> };
    return data.user ?? null;
  } catch {
    return null;
  }
}
