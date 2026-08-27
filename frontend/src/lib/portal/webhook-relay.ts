import { NextRequest, NextResponse } from "next/server";
import { DJANGO_API } from "@/lib/portal/config";
import { backendFetch } from "@/lib/portal/backend-fetch";

/** Public relay: preserve signed bytes, never forward browser credentials.
 * Django verifies the provider signature before parsing or persisting anything.
 */
export async function relayWebhook(req: NextRequest, provider: "fathom" | "slack", signatureHeaders: string[], maxBytes: number) {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (!Number.isFinite(length) || length < 0) return NextResponse.json({ error: "Invalid content length." }, { status: 400 });
  if (length > maxBytes) return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const name of signatureHeaders) {
    const value = req.headers.get(name);
    if (!value) return NextResponse.json({ error: "Missing webhook signature." }, { status: 401 });
    headers.set(name, value);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = req.body?.getReader();
  if (!reader) return NextResponse.json({ error: "Missing body." }, { status: 400 });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return NextResponse.json({ error: "Payload too large." }, { status: 413 });
      }
      chunks.push(value);
    }
  } catch {
    return NextResponse.json({ error: "Incomplete webhook body." }, { status: 400 });
  } finally {
    reader.releaseLock();
  }
  try {
    const response = await backendFetch(`${DJANGO_API}/onboarding/webhooks/${provider}/`, {
      method: "POST", headers, body: Buffer.concat(chunks), cache: "no-store", redirect: "manual",
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(15_000)]),
    });
    return new NextResponse(response.body, {
      status: response.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    // Non-2xx lets the provider retry; never acknowledge an unconfirmed save.
    return NextResponse.json({ error: "Import temporarily unavailable." }, { status: 503 });
  }
}
