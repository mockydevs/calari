import { NextRequest } from "next/server";
import { relayWebhook } from "@/lib/portal/webhook-relay";

export const dynamic = "force-dynamic";
export function POST(req: NextRequest) {
  return relayWebhook(req, "slack", ["x-slack-request-timestamp", "x-slack-signature"], 256 * 1024);
}
