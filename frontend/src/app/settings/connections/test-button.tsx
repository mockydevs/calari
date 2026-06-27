"use client";
import * as React from "react";
import { CheckCircle2, XCircle, Plug } from "lucide-react";
import { api, ApiError } from "@/lib/portal/api";
import { useToast, Spinner } from "@/components/toast";

/** Ping a saved connection's token to confirm it actually works. */
export function TestConnectionButton({ id }: { id: number }) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean } | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await api.post<{ ok: boolean; detail: string }>(`onboarding/connections/${id}/test`, {});
      setResult({ ok: res.ok });
      if (res.ok) toast.success(res.detail || "Connection works.", "Connected");
      else toast.error(res.detail || "Connection failed.", "Failed");
    } catch (err) {
      setResult({ ok: false });
      toast.error(err instanceof ApiError ? err.message : "Could not test the connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-60"
    >
      {busy ? <Spinner className="h-3.5 w-3.5" />
        : result?.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        : result && !result.ok ? <XCircle className="h-3.5 w-3.5 text-red-600" />
        : <Plug className="h-3.5 w-3.5" />}
      Test
    </button>
  );
}
