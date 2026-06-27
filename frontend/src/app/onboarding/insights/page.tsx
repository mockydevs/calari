import { AlertTriangle, ArrowLeft, CheckCircle2, ListChecks, Undo2 } from "lucide-react";
import Link from "next/link";
import { requireFeature } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { retractEvent } from "./actions";
import { UpsellPanel } from "./upsell-panel";

export const dynamic = "force-dynamic";

type Event = { id: number; target: string; status: string; external_ref: string; error: string };
type Insight = {
  id: number;
  client: number | null;
  client_name?: string | null;
  fireflies_call_id: string;
  title: string;
  call_date: string | null;
  summary: string;
  confidence: number | null;
  status: string;
  created_at: string;
  events: Event[];
};

function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

const STATUS_STYLE: Record<string, string> = {
  distributed: "bg-emerald-50 text-emerald-700",
  analyzed: "bg-indigo-50 text-indigo-700",
  processing: "bg-amber-50 text-amber-700",
  pending: "bg-slate-100 text-slate-600",
  skipped: "bg-orange-50 text-orange-700",
  failed: "bg-red-50 text-red-700",
};
const EVENT_STATUS_STYLE: Record<string, string> = {
  sent: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  failed: "bg-red-50 text-red-700 ring-red-200",
  skipped: "bg-orange-50 text-orange-700 ring-orange-200",
  retracted: "bg-slate-100 text-slate-500 ring-slate-200",
  pending: "bg-slate-50 text-slate-600 ring-slate-200",
};
const TARGET_LABEL: Record<string, string> = {
  ASANA: "Asana", SLACK_INTERNAL: "Slack · internal", SLACK_EXTERNAL: "Slack · external", DRIVE: "Drive doc",
};

export default async function CallInsightsPage() {
  await requireFeature("ai_keys");
  const insights = await serverApi
    .get<Insight[] | { results: Insight[] }>("onboarding/call-insights")
    .then(asList)
    .catch(() => [] as Insight[]);

  // Distinct clients that have insights → offer an upsell analysis for each.
  const clients = Array.from(
    new Map(insights.filter((i) => i.client).map((i) => [i.client, i.client_name || `Client ${i.client}`])).entries()
  ) as [number, string][];

  return (
    <div className="space-y-5">
      <Link href="/settings/connections" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Integrations
      </Link>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">Onboarding intelligence</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Call insights</h1>
        <p className="mt-1 text-sm text-slate-600">
          What the agent extracted from each Fireflies call and where it sent it. Failed or wrongly-posted
          actions can be retracted.
        </p>
      </div>

      {clients.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-950"><ListChecks className="h-4 w-4 text-pink-700" /> Predictive upsell</h2>
          <p className="mt-1 mb-3 text-xs text-slate-500">Mine a client&apos;s accumulated call insights for the next services to offer.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {clients.map(([id, name]) => <UpsellPanel key={id} clientId={id} clientName={name} />)}
          </div>
        </section>
      )}

      {insights.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">
          No calls processed yet. Once Fireflies fires a webhook for a mapped, active client, insights appear here.
        </p>
      ) : (
        <div className="space-y-3">
          {insights.map((ci) => (
            <section key={ci.id} className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-3.5">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-slate-950">{ci.title || ci.fireflies_call_id}</h2>
                  <p className="text-xs text-slate-500">
                    {ci.client_name || "Unattributed"} · {ci.call_date ? formatDate(ci.call_date) : formatDate(ci.created_at)}
                    {ci.confidence != null && <> · confidence {Math.round(ci.confidence * 100)}%</>}
                  </p>
                </div>
                <Badge className={STATUS_STYLE[ci.status] ?? "bg-slate-100 text-slate-600"}>{ci.status}</Badge>
              </div>
              <div className="space-y-3 px-5 py-4">
                {ci.summary && <p className="text-sm text-slate-700">{ci.summary}</p>}
                {ci.events.length > 0 && (
                  <ul className="space-y-1.5">
                    {ci.events.map((ev) => (
                      <li key={ev.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-100 px-3 py-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-700">{TARGET_LABEL[ev.target] ?? ev.target}</span>
                          <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold ring-1 ring-inset ${EVENT_STATUS_STYLE[ev.status] ?? EVENT_STATUS_STYLE.pending}`}>
                            {ev.status === "sent" ? <CheckCircle2 className="h-3 w-3" /> : ev.status === "failed" || ev.status === "skipped" ? <AlertTriangle className="h-3 w-3" /> : null}
                            {ev.status}
                          </span>
                          {ev.error && <span className="text-slate-400">— {ev.error}</span>}
                        </div>
                        {ev.status === "sent" && (
                          <form action={retractEvent}>
                            <input type="hidden" name="id" value={ev.id} />
                            <Button type="submit" size="sm" variant="outline" className="h-7 border-slate-200 text-slate-600 hover:bg-red-50 hover:text-red-700">
                              <Undo2 className="h-3.5 w-3.5" /> Retract
                            </Button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
