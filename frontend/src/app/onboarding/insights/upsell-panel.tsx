"use client";
import * as React from "react";
import { Sparkles } from "lucide-react";
import { api, ApiError } from "@/lib/portal/api";
import { useToast, Spinner } from "@/components/toast";

type Suggestion = { service: string; rationale: string; confidence: string };

const CONF_STYLE: Record<string, string> = {
  high: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  medium: "bg-amber-50 text-amber-700 ring-amber-200",
  low: "bg-slate-50 text-slate-600 ring-slate-200",
};

/** On-demand predictive upsell suggestions for a client (Phase 5). */
export function UpsellPanel({ clientId, clientName }: { clientId: number; clientName: string }) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const [suggestions, setSuggestions] = React.useState<Suggestion[] | null>(null);

  async function run() {
    setBusy(true);
    try {
      const res = await api.get<{ suggestions: Suggestion[]; detail?: string }>(`onboarding/clients/${clientId}/upsell`);
      setSuggestions(res.suggestions ?? []);
      if (res.detail && (res.suggestions ?? []).length === 0) toast.info(res.detail);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not generate upsell ideas.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="inline-flex h-8 items-center gap-2 rounded-md border border-pink-200 bg-pink-50 px-3 text-xs font-semibold text-pink-700 transition-colors hover:bg-pink-100 disabled:opacity-60"
      >
        {busy ? <><Spinner className="h-3.5 w-3.5" /> Analyzing…</> : <><Sparkles className="h-3.5 w-3.5" /> Suggest upsells for {clientName}</>}
      </button>
      {suggestions && suggestions.length > 0 && (
        <ul className="mt-3 space-y-2">
          {suggestions.map((s, i) => (
            <li key={i} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-900">{s.service}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-inset ${CONF_STYLE[s.confidence] ?? CONF_STYLE.low}`}>{s.confidence}</span>
              </div>
              <p className="mt-1 text-xs text-slate-600">{s.rationale}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
