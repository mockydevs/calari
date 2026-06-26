"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import { api, ApiError } from "@/lib/portal/api";
import { useToast, Spinner } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { resolveGap } from "./actions";
import { GAP_SEVERITY_STYLE, GAP_CATEGORY_LABEL, type VisionGap } from "./_shared";

/**
 * Resolve a single vision gap. Offers AI-suggested answers (click to use, then
 * edit) plus free typing — then Save answer / Dismiss. All errors surface as
 * toasts; nothing falls through to the route error boundary.
 */
export function GapResolver({ gap, buildId }: { gap: VisionGap; buildId: string }) {
  const toast = useToast();
  const [answer, setAnswer] = React.useState("");
  const [options, setOptions] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [pending, start] = React.useTransition();
  const [mode, setMode] = React.useState<"ANSWERED" | "DISMISSED" | null>(null);

  async function suggest() {
    setLoading(true);
    try {
      const res = await api.post<{ options: string[] }>(`builds/vision-gaps/${gap.id}/suggest`, {});
      setOptions(res.options ?? []);
      if (!res.options?.length) toast.error("No suggestions returned — type an answer instead.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not get AI suggestions.");
    } finally {
      setLoading(false);
    }
  }

  function submit(status: "ANSWERED" | "DISMISSED") {
    if (status === "ANSWERED" && !answer.trim()) {
      toast.error("Add or pick an answer first.");
      return;
    }
    setMode(status);
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("id", String(gap.id));
        fd.set("buildId", buildId);
        fd.set("status", status);
        if (answer.trim()) fd.set("answer", answer.trim());
        await resolveGap(fd);
        toast.success(status === "ANSWERED" ? "Answer saved." : "Gap dismissed.");
      } catch (e) {
        if (e instanceof Error && !e.message.includes("NEXT_REDIRECT")) toast.error(e.message);
      } finally {
        setMode(null);
      }
    });
  }

  return (
    <li className="rounded-md border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-inset ${GAP_SEVERITY_STYLE[gap.severity]}`}>{gap.severity}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">{GAP_CATEGORY_LABEL[gap.category] ?? gap.category}</span>
      </div>
      <p className="mt-1.5 text-sm font-medium text-slate-900">{gap.question}</p>
      {gap.rationale && <p className="mt-0.5 text-xs text-slate-500">{gap.rationale}</p>}

      {/* AI-suggested answers */}
      <div className="mt-2.5">
        <button
          type="button"
          onClick={suggest}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-pink-200 bg-pink-50 px-2.5 py-1 text-xs font-semibold text-pink-700 transition-colors hover:bg-pink-100 disabled:opacity-60"
        >
          {loading ? <Spinner className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
          {options.length ? "Regenerate suggestions" : "Suggest answers (AI)"}
        </button>
        {options.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {options.map((o, i) => {
              const active = answer.trim() === o.trim();
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setAnswer(o)}
                  className={`block w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    active
                      ? "border-pink-400 bg-pink-50/70 text-slate-800"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {o}
                </button>
              );
            })}
            <p className="text-[11px] text-slate-400">Click a suggestion to use it, then edit below — or type your own.</p>
          </div>
        )}
      </div>

      <div className="mt-2.5 space-y-2">
        <Textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={2}
          placeholder="Capture the answer from the client…"
        />
        <div className="flex items-center gap-2">
          <Button type="button" onClick={() => submit("ANSWERED")} disabled={pending} size="sm">
            {pending && mode === "ANSWERED" && <Spinner className="h-3.5 w-3.5" />} Save answer
          </Button>
          <Button type="button" onClick={() => submit("DISMISSED")} disabled={pending} size="sm" variant="outline">
            {pending && mode === "DISMISSED" && <Spinner className="h-3.5 w-3.5" />} Dismiss
          </Button>
        </div>
      </div>
    </li>
  );
}
