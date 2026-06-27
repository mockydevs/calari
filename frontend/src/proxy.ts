import { NextRequest, NextResponse } from "next/server";

// Public paths that don't require a session.
// /api/a2p-intake is the public relay for the marketing-site A2P form (anonymous).
const PUBLIC_PATHS = ["/login", "/signup", "/portal", "/api/portal", "/api/health", "/api/a2p-intake"];

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Gate everything else on the Django JWT cookie bridged by the BFF.
  const hasSession = req.cookies.get("calari_access") || req.cookies.get("calari_refresh");
  if (!hasSession) {
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
