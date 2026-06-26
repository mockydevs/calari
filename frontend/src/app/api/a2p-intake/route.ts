import { NextRequest, NextResponse } from "next/server";
import { DJANGO_API } from "@/lib/portal/config";

export const dynamic = "force-dynamic";

// PUBLIC (no auth) A2P intake endpoint. The marketing site (calarisolutions.com)
// posts the intake form here; we forward server-side to Django's public create
// endpoint. This is the only public path to the internal API, so the website
// never needs the Django URL or CORS.
const CORS = {
  "Access-Control-Allow-Origin": process.env.A2P_INTAKE_ORIGIN || "https://calarisolutions.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  let body: string;
  try {
    body = JSON.stringify(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400, headers: CORS });
  }
  try {
    const res = await fetch(`${DJANGO_API}/a2p/submissions/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { ...CORS, "Content-Type": res.headers.get("content-type") || "application/json" },
    });
  } catch {
    return NextResponse.json(
      { error: "Could not reach the registration service. Please try again shortly." },
      { status: 502, headers: CORS },
    );
  }
}
