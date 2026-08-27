import { NextRequest } from "next/server";
import { relayWebhook } from "@/lib/portal/webhook-relay";

export const dynamic = "force-dynamic";
export function POST(req: NextRequest) {
  return relayWebhook(req, "fathom", ["webhook-id", "webhook-timestamp", "webhook-signature"], 2 * 1024 * 1024);
}
