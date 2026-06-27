"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Upload } from "lucide-react";
import { api, ApiError } from "@/lib/portal/api";
import { useToast, Spinner } from "@/components/toast";
import { type ProgressReport } from "./_shared";

/**
 * Staff submit a progress report (paste or document upload). The AI audits it against
 * the tasklist — checking off verified work and pushing back on anything missing or
 * incorrectly built. Polls the newest report's ai_status until the audit completes.
 */
export function ProgressReportPanel({
  buildId, reports,
}: { buildId: string; reports: ProgressReport[] }) {
  const router = useRouter();
  const toast = useToast();
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function poll() {
    const deadline = Date.now() + 120_000;
    const tick = async () => {
      const res = await api.get<{ progress_reports?: ProgressReport[] }>(`builds/builds/${buildId}`).catch(() => null);
      const latest = res?.progress_reports?.[0];
      const status = latest?.ai_status;
      if (status === "done") {
        toast.success(`Audit complete — ${latest?.verified_count ?? 0} verified, ${latest?.needs_info_count ?? 0} need info.`, "Done");
        setBusy(false); setText(""); router.refresh(); return;
      }
      if (status === "failed") {
        toast.error("Audit failed — check Settings → AI Keys and try again.", "Failed");
        setBusy(false); return;
      }
      if (Date.now() > deadline) { setBusy(false); router.refresh(); return; }
      setTimeout(tick, 2500);
    };
    setTimeout(tick, 2500);
  }

  async function submitText() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.post(`builds/builds/${buildId}/report-progress`, { raw_text: text });
      toast.info("Auditing your report against the tasklist…", "Working…");
      poll();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not submit the report.");
      setBusy(false);
    }
  }

  async function submitFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.append("file", file);
    form.append("build", buildId);
    try {
      await api.upload(`builds/progress-reports/upload`, form);
      toast.info("Reading the document and auditing it…", "Working…");
      poll();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not upload the document.");
      setBusy(false);
    }
  }

  const latest = reports[0];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
        <ClipboardCheck className="h-4 w-4 text-pink-700" /> Report progress
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Paste or upload what you&apos;ve built. The AI verifies each item against the tasklist — checking off
        what&apos;s genuinely done and pushing back on anything missing, incomplete, or built incorrectly.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        disabled={busy}
        placeholder="e.g. Built Automation A1 (Lead Nurture): triggers on New Lead stage, sends 3-email sequence over 5 days, stops on booking, moves opportunity to Engaged…"
        className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500 disabled:bg-slate-50"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={submitText}
          disabled={busy || !text.trim()}
          className="inline-flex h-8 items-center gap-2 rounded-md bg-gradient-to-r from-pink-600 to-fuchsia-600 px-3 text-xs font-semibold text-white shadow-sm hover:from-pink-700 hover:to-fuchsia-700 disabled:opacity-60"
        >
          {busy ? <><Spinner className="h-3.5 w-3.5" /> Auditing…</> : <><ClipboardCheck className="h-3.5 w-3.5" /> Submit & verify</>}
        </button>
        <label className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 ${busy ? "pointer-events-none opacity-60" : ""}`}>
          <Upload className="h-3.5 w-3.5" /> Upload doc
          <input type="file" className="hidden" onChange={submitFile} accept=".pdf,.docx,.txt,.csv,.md,.rtf" />
        </label>
        <span className="text-xs text-slate-400">PDF, DOCX, TXT, CSV, MD, RTF</span>
      </div>

      {/* Latest audit result */}
      {latest && latest.ai_status === "done" && (
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
              <CheckCircle2 className="h-3.5 w-3.5" /> {latest.verified_count} verified
            </span>
            {latest.needs_info_count > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
                <AlertTriangle className="h-3.5 w-3.5" /> {latest.needs_info_count} need info
              </span>
            )}
            <span className="text-slate-400">latest audit · {new Date(latest.created_at).toLocaleDateString()}</span>
          </div>
          {latest.summary && <p className="text-sm text-slate-700">{latest.summary}</p>}
          {latest.pushback?.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-800">AI needs clarification before this is complete:</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-amber-900">
                {latest.pushback.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {reports.length > 1 && (
        <details className="mt-3 border-t border-slate-100 pt-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-500">Report history ({reports.length})</summary>
          <ul className="mt-2 space-y-1.5">
            {reports.map((r) => (
              <li key={r.id} className="text-xs text-slate-600">
                <span className="text-slate-400">{new Date(r.created_at).toLocaleDateString()}</span>
                {" · "}{r.verified_count} verified, {r.needs_info_count} need info
                {r.created_by_name ? ` · ${r.created_by_name}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
