"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/portal/api";
import { Button } from "@/components/ui/button";

type Result = { status: string; note: string; checked_at?: string | null };
const labels: Record<string, string> = {
  PENDING: "Queued for GHL check", PROCESSING: "Checking GHL",
  NEEDS_EVIDENCE: "Needs evidence", ACCESS_ISSUE: "Check unavailable", NOT_CONNECTED: "No GHL connection",
  FAILED_CHECK: "Acceptance check failed", PASSED_CHECKS: "Specified checks passed — functional testing still required",
};

export function GhlVerification({ taskId, initial, canRetry }: { taskId: number; initial: Result; canRetry: boolean }) {
  const [result, setResult] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = result.status === "PENDING" || result.status === "PROCESSING";
  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api.get<Result>(`builds/tasks/${taskId}/ghl-verification`);
        if (cancelled) return;
        setResult(next);
        if ((next.status === "PENDING" || next.status === "PROCESSING") && ++attempts < 60) timer = setTimeout(poll, 5000);
        else if (attempts >= 60) setError("Still waiting. Refresh later; the completion-check worker may be offline.");
      } catch {
        if (!cancelled) setError("Could not refresh the check. Reload the page to try again.");
      }
    };
    timer = setTimeout(poll, 5000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pending, taskId]);
  return (
    <div className="mt-3 rounded-md border border-amber-100 bg-amber-50/50 p-3 text-xs text-slate-700">
      <p className="font-semibold">GHL verification · {labels[result.status] || "Not checked"}</p>
      <p className="mt-1">Staff completion is recorded separately from verified correctness.</p>
      {result.note && <details className="mt-2"><summary className="cursor-pointer">Check results and next steps</summary><p className="mt-2 whitespace-pre-wrap leading-5">{result.note}</p></details>}
      {result.checked_at && <p className="mt-2 text-slate-500">Checked {new Date(result.checked_at).toLocaleString()}</p>}
      {canRetry && !pending && <Button type="button" size="sm" variant="outline" className="mt-2" disabled={busy} onClick={async () => {
        setBusy(true); setError("");
        try { setResult(await api.post<Result>(`builds/tasks/${taskId}/ghl-verification`)); }
        catch (err) { setError(err instanceof Error ? err.message : "Could not queue the check."); }
        finally { setBusy(false); }
      }}>{busy ? "Queuing…" : "Run GHL check"}</Button>}
      {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
    </div>
  );
}
