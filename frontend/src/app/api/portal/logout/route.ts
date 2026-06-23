import { NextResponse } from "next/server";
import { DJANGO_API } from "@/lib/portal/config";
import { clearTokens, djangoCookieHeader, getTokens } from "@/lib/portal/server";

export const dynamic = "force-dynamic";

/** Blacklist the refresh token on Django, then clear the Next cookies. */
export async function POST() {
  const { access, refresh } = await getTokens();
  try {
    await fetch(`${DJANGO_API}/token/logout/`, {
      method: "POST",
      headers: { Cookie: djangoCookieHeader(access, refresh) },
      cache: "no-store",
    });
  } catch {
    /* best-effort; clear local session regardless */
  }
  await clearTokens();
  return NextResponse.json({ ok: true });
}
