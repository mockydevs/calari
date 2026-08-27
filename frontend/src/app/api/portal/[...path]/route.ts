import { NextRequest, NextResponse } from "next/server";
import { DJANGO_API } from "@/lib/portal/config";
import { djangoCookieHeader, getTokens, refreshAccess } from "@/lib/portal/server";
import { backendFetch } from "@/lib/portal/backend-fetch";

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
    backendFetch(target, {
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
      signal: req.signal,
    });

  // Django uses redirect-based auth: unauthenticated/expired requests 302 to
  // /login/ rather than returning 401. Treat both as an auth challenge.
  const isAuthChallenge = (r: Response) =>
    r.status === 401 ||
    (r.status >= 300 && r.status < 400 && (r.headers.get("location") || "").includes("/login"));

  let res: Response;
  try {
    res = await doFetch(access);
    if (isAuthChallenge(res) && refresh) {
      await res.body?.cancel();
      const newAccess = await refreshAccess(refresh);
      if (newAccess) {
        access = newAccess;
        res = await doFetch(newAccess);
      }
    }
  } catch (error) {
    const timeout = error instanceof Error && error.name === "TimeoutError";
    return NextResponse.json(
      { error: timeout ? "The server took too long to respond. Check the latest state before retrying." : "The server is unavailable. Please try again shortly." },
      { status: timeout ? 504 : 502 },
    );
  }

  // Still unauthenticated → return a clean 401 (never leak the cross-origin redirect).
  if (isAuthChallenge(res)) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  // Stream downloads instead of buffering them in Next's heap. No-content
  // statuses must use null: even an empty ArrayBuffer is an invalid body.
  const resBody = [204, 205, 304].includes(res.status) ? null : res.body;
  const out = new NextResponse(resBody, { status: res.status });
  const contentType = res.headers.get("content-type");
  if (contentType) out.headers.set("content-type", contentType);
  const disposition = res.headers.get("content-disposition");
  if (disposition) out.headers.set("content-disposition", disposition);
  // Authenticated responses and private report files must not enter shared caches.
  out.headers.set("cache-control", "private, no-store");
  out.headers.set("x-content-type-options", "nosniff");
  return out;
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
