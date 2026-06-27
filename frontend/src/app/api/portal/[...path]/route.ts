import { NextRequest, NextResponse } from "next/server";
import { DJANGO_API } from "@/lib/portal/config";
import { djangoCookieHeader, getTokens, refreshAccess } from "@/lib/portal/server";

export const dynamic = "force-dynamic";

/** Headers we never forward upstream. */
const STRIP = new Set(["host", "cookie", "connection", "content-length", "accept-encoding"]);

function buildTarget(path: string[], search: string): string {
  const sub = path.map(encodeURIComponent).join("/");
  // DRF expects a trailing slash on collection/detail routes.
  const trailing = sub.endsWith("/") ? "" : "/";
  return `${DJANGO_API}/${sub}${trailing}${search}`;
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const target = buildTarget(path, req.nextUrl.search);

  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await req.arrayBuffer() : undefined;

  // Forward a curated set of request headers.
  const fwd = new Headers();
  req.headers.forEach((value, key) => {
    if (!STRIP.has(key.toLowerCase())) fwd.set(key, value);
  });

  const tokens = await getTokens();
  let access = tokens.access;
  const refresh = tokens.refresh;

  const doFetch = (token?: string) =>
    fetch(target, {
      method,
      headers: (() => {
        const h = new Headers(fwd);
        h.set("Cookie", djangoCookieHeader(token, refresh));
        if (token) h.set("Authorization", `Bearer ${token}`);
        return h;
      })(),
      body: body ? Buffer.from(body) : undefined,
      redirect: "manual",
      cache: "no-store",
    });

  // Django uses redirect-based auth: unauthenticated/expired requests 302 to
  // /login/ rather than returning 401. Treat both as an auth challenge.
  const isAuthChallenge = (r: Response) =>
    r.status === 401 ||
    (r.status >= 300 && r.status < 400 && (r.headers.get("location") || "").includes("/login"));

  let res = await doFetch(access);

  if (isAuthChallenge(res) && refresh) {
    const newAccess = await refreshAccess(refresh);
    if (newAccess) {
      access = newAccess;
      res = await doFetch(newAccess);
    }
  }

  // Still unauthenticated → return a clean 401 (never leak the cross-origin redirect).
  if (isAuthChallenge(res)) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const resBody = await res.arrayBuffer();
  const out = new NextResponse(resBody, { status: res.status });
  const contentType = res.headers.get("content-type");
  if (contentType) out.headers.set("content-type", contentType);
  const disposition = res.headers.get("content-disposition");
  if (disposition) out.headers.set("content-disposition", disposition);
  return out;
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
