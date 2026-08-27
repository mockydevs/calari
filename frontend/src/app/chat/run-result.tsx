"use client";

import { useRef, useState } from "react";
import { AlertCircle, Check, ChevronDown, Download, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast";
import { api } from "@/lib/portal/api";
import { downloadChatExport } from "./exports";
import { ResponseText } from "./response-text";
import { cellText, isWorking, type ChatAccount, type ChatRun } from "./types";

const STATUS_TEXT: Record<ChatRun["status"], string> = {
  queued: "Waiting for the background worker…", running: "Checking GHL and preparing your answer…",
  awaiting_confirmation: "Your confirmation is required", execute_queued: "Approved. Waiting to execute…",
  executing: "Executing the confirmed operation…", done: "Complete", failed: "Could not complete this request",
  unknown: "The outcome needs to be checked in GHL", rejected: "Action declined — nothing was executed",
};

export function RunResult({ run, account, onUpdate }: { run: ChatRun; account?: ChatAccount; onUpdate: (run: ChatRun) => void }) {
  const toast = useToast();
  const modal = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const operation = run.proposal?.operation;
  const rows = run.rows ?? [];
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const problem = run.status === "failed" || run.status === "unknown";

  async function decide(decision: "approve" | "reject") {
    if (inFlight.current || !run.proposal.hash) return;
    inFlight.current = true;
    setPending(true);
    try {
      const next = await api.post<ChatRun>(`ghl-chat/runs/${run.id}/confirm/`, { proposal_hash: run.proposal.hash, decision });
      onUpdate(next);
      modal.current?.close();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not confirm the action.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  async function exportReport(format: "csv" | "pdf") {
    setExporting(format);
    try { await downloadChatExport(run.id, format); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Download failed."); }
    finally { setExporting(null); }
  }

  return <article className="space-y-5 border-b border-slate-100 pb-8 last:border-0" aria-label="Question and answer">
    <div className="flex justify-end"><p className="max-w-[90%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-slate-100 px-5 py-3 text-sm leading-6 text-slate-900">{run.question}</p></div>
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-950 text-[9px] font-bold text-white">AI</span>
        <span>GHL assistant</span>
        <span className="text-slate-300">·</span>
        <time dateTime={run.created_at}>{new Date(run.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
      </div>
      {run.answer && <ResponseText text={run.answer} />}
      {run.status !== "done" && <div role="status" className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${problem ? "bg-red-50 text-red-800" : "bg-slate-50 text-slate-600"}`}>
        {isWorking(run.status) ? <Loader2 className="h-4 w-4 shrink-0 motion-safe:animate-spin" /> : problem ? <AlertCircle className="h-4 w-4 shrink-0" /> : null}
        {STATUS_TEXT[run.status]}
      </div>}
      {run.status === "unknown" && <p className="text-xs leading-5 text-red-700">The request may have reached GHL. Check the account before repeating it to avoid duplicate changes or messages.</p>}
      {!!run.limitations?.length && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900"><p className="font-semibold">Data limits & assumptions</p><ul className="mt-1 list-disc space-y-1 pl-4">{run.limitations.map((limit, i) => <li key={i}>{limit}</li>)}</ul></div>}
      {run.status === "awaiting_confirmation" && operation && <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50/40 p-4">
        <p className="text-sm font-semibold">Proposed action: {operation.summary || operation.operationId}</p>
        <p className="text-xs leading-5 text-slate-600">Account: <strong>{account?.name}</strong>. Nothing has been changed yet. Review the exact parameters before allowing this action.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" disabled={!account?.can_execute || pending} onClick={() => modal.current?.showModal()}>Review & confirm</Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => void decide("reject")}>Decline</Button>
        </div>
        {!account?.can_execute && <p className="text-xs text-amber-900">Your account grant allows reading only. An administrator must grant execution permission.</p>}
      </div>}
      {!!rows.length && <details className="rounded-lg border border-slate-200" open={rows.length <= 10}>
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-xs font-semibold text-slate-700">Result data · {run.row_count ?? rows.length} rows<ChevronDown className="h-4 w-4" /></summary>
        <div className="max-h-80 overflow-auto border-t border-slate-100"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-slate-50"><tr>{columns.map((key) => <th key={key} className="whitespace-nowrap px-3 py-2 font-semibold">{key}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i} className="border-t border-slate-100">{columns.map((key) => <td key={key} className="max-w-sm break-words px-3 py-2 align-top">{cellText(row[key])}</td>)}</tr>)}</tbody></table></div>
        {run.rows_truncated && <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Showing {rows.length} rows. Export CSV for all retrieved rows; API limits still apply.</p>}
      </details>}
      {!!run.evidence?.length && <details className="rounded-lg border border-slate-200 px-4 py-3">
        <summary className="cursor-pointer text-xs font-semibold text-slate-600">API evidence · {run.evidence.length} sources</summary>
        <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs leading-5 text-slate-600">{JSON.stringify(run.evidence, null, 2)}</pre>
      </details>}
      <div className="flex flex-wrap items-center gap-2">
        {run.csv_url && <Button size="sm" variant="ghost" disabled={!!exporting} onClick={() => void exportReport("csv")}><Download className="h-3.5 w-3.5" />{exporting === "csv" ? "Downloading…" : "Export CSV"}</Button>}
        {run.pdf_url && <Button size="sm" variant="ghost" disabled={!!exporting} onClick={() => void exportReport("pdf")}><Download className="h-3.5 w-3.5" />{exporting === "pdf" ? "Downloading…" : "Export PDF"}</Button>}
        {run.finished_at && <span className="text-[11px] text-slate-400">Retrieved {new Date(run.finished_at).toLocaleString()}</span>}
      </div>
      {run.export_error && <p role="alert" className="text-xs text-amber-800">Export unavailable: {run.export_error}</p>}
    </div>
    <dialog ref={modal} aria-labelledby={`confirm-${run.id}`} className="fixed inset-0 m-auto max-h-[85dvh] w-[min(640px,calc(100%_-_2rem))] overflow-auto rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-950/50" onCancel={(event) => { if (pending) event.preventDefault(); }}>
      <div className="flex items-center justify-between border-b border-slate-100 p-5"><h2 id={`confirm-${run.id}`} className="font-semibold">Confirm GHL action</h2><button type="button" aria-label="Close confirmation" disabled={pending} onClick={() => modal.current?.close()} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
      <div className="space-y-4 p-5 text-sm">
        <p>This will execute against <strong>{account?.name}</strong> ({account?.location_id}). It may change or delete records, move money, or send a message, depending on the operation below.</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg bg-slate-50 p-4 text-xs"><dt className="text-slate-500">Operation</dt><dd className="break-all font-semibold">{operation?.operationId}</dd><dt className="text-slate-500">Method / path</dt><dd className="break-all font-mono">{operation?.method} {operation?.path}</dd><dt className="text-slate-500">Type</dt><dd>{operation?.kind || "Requires confirmation"}</dd><dt className="text-slate-500">Expires</dt><dd>{run.proposal.expires_at ? new Date(run.proposal.expires_at).toLocaleString() : "—"}</dd></dl>
        <div><h3 className="mb-2 text-xs font-semibold">Exact parameters</h3><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">{JSON.stringify(run.proposal.params, null, 2)}</pre></div>
        <p className="text-xs leading-5 text-amber-800">Approval applies only to this operation and these parameters. Changes and outbound messages may not be reversible.</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-100 p-5"><Button variant="outline" disabled={pending} onClick={() => modal.current?.close()}>Cancel</Button><Button variant="danger" disabled={pending || !account?.can_execute} onClick={() => void decide("approve")}>{pending ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <Check className="h-4 w-4" />}Confirm & execute</Button></div>
    </dialog>
  </article>;
}
