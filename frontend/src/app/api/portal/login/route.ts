import { NextRequest, NextResponse } from "next/server";
import { DJANGO_ACCESS_COOKIE, DJANGO_API, DJANGO_REFRESH_COOKIE, parseSetCookie } from "@/lib/portal/config";
import { setTokens } from "@/lib/portal/server";

export const dynamic = "force-dynamic";

/** Bridge Django cookie-JWT login into Next httpOnly cookies. */
export async function POST(req: NextRequest) {
  let payload: { username_or_email?: string; password?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const username_or_email = (payload.username_or_email ?? "").trim();
  const password = payload.password ?? "";
  if (!username_or_email || !password) {
    return NextResponse.json({ error: "Email/username and password are required." }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(`${DJANGO_API}/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username_or_email, password }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Network error — please try again." }, { status: 502 });
  }

  if (!res.ok) {
    let message = "Invalid credentials.";
    try {
      const data = await res.json();
      message = data.detail || data.error || message;
    } catch {
      /* keep default */
    }
    return NextResponse.json({ error: message }, { status: res.status });
  }

  const setCookies = res.headers.getSetCookie?.() ?? [];
  const access = parseSetCookie(setCookies, DJANGO_ACCESS_COOKIE);
  const refresh = parseSetCookie(setCookies, DJANGO_REFRESH_COOKIE);
  if (!access) {
    return NextResponse.json({ error: "Login did not return a session." }, { status: 502 });
  }
  await setTokens({ access, refresh });
  return NextResponse.json({ ok: true });
}
