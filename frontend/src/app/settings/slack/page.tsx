import Link from "next/link";
import { requireAdmin } from "@/lib/auth-helpers";
import { SlackWorkspace } from "./workspace";
import { SlackContextConnection } from "./context-connection";

export default async function SlackPage() {
  await requireAdmin();
  return <div className="space-y-6">
    <header><Link href="/settings/connections" className="text-sm text-slate-500 hover:underline">Integrations</Link><h1 className="mt-3 text-3xl font-semibold tracking-tight">Slack delivery routing</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Assign responsibilities once. Client questions and work go directly to the right staff with the original message and AI interpretation. No approval queue for Clare.</p></header>
    <SlackContextConnection />
    <SlackWorkspace />
  </div>;
}
