"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/portal/api";
import { Button } from "@/components/ui/button";
import { SlackContext } from "./slack-context";
import { AcceptanceChecks } from "./acceptance-checks";

type Evidence = { key: string; source: string; reference: string; observation: Record<string, unknown>; completeness: string; retrieved_at: string };
type Brief = { summary: string; observations?: { text: string; evidence: string[] }[]; hypotheses?: string[]; actions?: string[]; acceptance_checks?: string[]; questions?: string[] };
type Context = { revision?: string; status: string; reason: string; completed_at?: string; evidence: Evidence[]; brief: Brief | null; draft?: { text: string; version: number; ready: boolean; stale: boolean; edited: boolean } | null };
const TABS = ["Original", "GHL evidence", "Suggested work", "Reply draft"] as const;

function EvidenceCard({ item }: { item: Evidence }) {
  const observation = item.observation;
  const records = Array.isArray(observation.records) ? observation.records as Record<string, unknown>[] : null;
  const message = observation.error || observation.note || observation.text;
  return <details className="rounded-lg border border-slate-200 p-3">
    <summary className="cursor-pointer text-sm font-medium">{item.key.replace("ghl:", "GHL · ")} <span className="ml-2 text-xs font-normal text-slate-500">{item.completeness}{records ? ` · ${records.length} shown` : ""}</span></summary>
    <p className="mt-2 text-xs text-slate-500">{item.source} · {item.reference} · {new Date(item.retrieved_at).toLocaleString()}{typeof observation.transport === "string" ? ` · ${observation.transport}` : ""}</p>
    {typeof message === "string" && <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{message}</p>}
    {records && <div className="mt-3 max-h-80 overflow-auto"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-slate-50"><tr><th className="p-2">Resource</th><th className="p-2">ID</th><th className="p-2">State / type</th></tr></thead><tbody>{records.map((row, index) => <tr key={index} className="border-t border-slate-100"><td className="p-2">{String(row.name || "Unnamed")}</td><td className="break-all p-2 font-mono">{String(row.id || "Not exposed")}</td><td className="p-2">{String(row.status || row.dataType || "—")}</td></tr>)}</tbody></table></div>}
    {typeof observation.limitation === "string" && <p className="mt-3 text-xs leading-5 text-slate-500">{observation.limitation}</p>}
    <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">Source details</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words leading-5">{JSON.stringify(observation, null, 2)}</pre></details>
  </details>;
}

export function ClientContext({ taskId, slack }: { taskId: number; slack: boolean }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]>(slack ? "Original" : "GHL evidence");
  const [data, setData] = useState<Context | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [record, setRecord] = useState("");
  const [draft, setDraft] = useState("");
  const dirty = useRef(false);
  const draftBase = useRef<{ version: number; revision: string } | null>(null);
  const root = `builds/tasks/${taskId}`;
  const accept = useCallback((next: Context) => {
    setData(next);
    if (!dirty.current && next.draft && next.revision) {
      setDraft(next.draft.text);
      draftBase.current = { version: next.draft.version, revision: next.revision };
    }
  }, []);
  const load = useCallback(async () => { accept(await api.get<Context>(`${root}/client-context`)); }, [root, accept]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : "Could not load context."); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!open || !["pending", "processing"].includes(data?.status || "")) return;
    let attempts = 0;
    const timer = setInterval(() => {
      if (++attempts > 18) { clearInterval(timer); return; }
      void load().catch(() => { clearInterval(timer); setError("Context polling stopped. Refresh to check progress."); });
    }, 5000);
    return () => clearInterval(timer);
  }, [open, data?.status, load]);
  const save = (ready: boolean) => run(async () => {
    if (!draftBase.current) return;
    await api.put(`${root}/reply-draft`, { ...draftBase.current, text: draft, ready });
    dirty.current = false;
    await load();
    setNotice(ready ? "Marked ready in the portal. Nothing sent to Slack." : "Draft saved in the portal.");
  });
  return <section className="mt-4 overflow-hidden rounded-lg border border-slate-200">
    <button type="button" aria-expanded={open} className="flex w-full items-center justify-between bg-slate-50 px-4 py-3 text-left text-sm font-semibold" onClick={() => { setOpen(!open); if (!open && !data) void run(load); }}>
      <span>Client context & reply</span><span className="text-xs font-normal text-slate-500">{data?.status.replaceAll("_", " ") || "Original, evidence and next steps"}</span>
    </button>
    {open && <div className="p-4">
      <div className="flex flex-wrap gap-2 border-b border-slate-100 pb-3" role="tablist" aria-label="Client context">
        {TABS.filter(value => slack || value !== "Original").map(value => <button type="button" role="tab" aria-selected={tab === value} key={value} onClick={() => setTab(value)} className={`rounded-md px-3 py-2 text-xs font-medium ${tab === value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>{value}</button>)}
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">{data?.reason || "Loading context…"}</p>
      {data?.completed_at && <p className="text-xs text-slate-400">Retrieved {new Date(data.completed_at).toLocaleString()}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mt-3 text-sm text-emerald-700">{notice}</p>}
      <div role="tabpanel" className="mt-4 space-y-3">
        {tab === "Original" && <SlackContext taskId={taskId} embedded />}
        {tab === "GHL evidence" && <>
          <p className="text-xs text-slate-500">Observations are bounded reads, not proof of correct execution. Missing data may reflect scope or pagination limits.</p>
          {data?.evidence.map(item => <EvidenceCard key={item.key} item={item} />)}
          {!data?.evidence.length && <p className="text-sm text-slate-500">No current evidence available.</p>}
          <AcceptanceChecks taskId={taskId} />
        </>}
        {tab === "Suggested work" && (data?.brief ? <>
          <p className="text-sm leading-6">{data.brief.summary}</p>
          {!!data.brief.observations?.length && <div><h3 className="text-sm font-semibold">Observations</h3>{data.brief.observations.map((item, index) => <p key={index} className="mt-2 text-sm">{item.text}<span className="block text-xs text-slate-500">Sources: {item.evidence.join(", ")}</span></p>)}</div>}
          {([ ["Hypotheses — not confirmed", data.brief.hypotheses], ["Suggested actions", data.brief.actions], ["Acceptance checks", data.brief.acceptance_checks], ["Missing context / questions", data.brief.questions] ] as const).map(([label, items]) => !!items?.length && <div key={label}><h3 className="text-sm font-semibold">{label}</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">{items.map((item, index) => <li key={index}>{item}</li>)}</ul></div>)}
        </> : <p className="text-sm text-slate-500">Request context to prepare a staff brief.</p>)}
        {tab === "Reply draft" && <>
          <p className="text-xs leading-5 text-slate-500">Private draft for staff to edit. Check every claim and remove internal names or notes before copying. There is no Slack send action.</p>
          {data?.draft?.stale && <p className="text-xs text-amber-800">New context arrived. Your saved edits were preserved; review them against the updated evidence.</p>}
          <textarea aria-label="Reply draft" className="min-h-40 w-full rounded-md border border-slate-200 p-3 text-sm leading-6" value={draft} disabled={!data?.draft} onChange={event => { dirty.current = true; setDraft(event.target.value); }} />
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy || !data?.draft} onClick={() => void save(false)}>Save draft</Button><Button size="sm" disabled={busy || !data?.draft || !draft.trim()} onClick={() => void save(true)}>Mark ready</Button><Button size="sm" variant="outline" disabled={!draft} onClick={() => void run(async () => { await navigator.clipboard.writeText(draft); setNotice("Draft copied. Nothing sent to Slack."); })}>Copy</Button>{data?.draft?.ready && <span className="self-center text-xs text-emerald-700">Ready in portal</span>}</div>
        </>}
      </div>
      <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
        <label className="min-w-52 flex-1 text-xs text-slate-600">Exact GHL contact ID (optional; needs client permission)<input value={record} onChange={event => setRecord(event.target.value)} maxLength={120} className="mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm" placeholder="No names or broad contact searches" /></label>
        <Button size="sm" disabled={busy || ["pending", "processing"].includes(data?.status || "")} onClick={() => void run(async () => accept(await api.post<Context>(`${root}/client-context`, { record_reference: record })))}>Investigate / refresh</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(load)}>Check status</Button>
      </div>
    </div>}
  </section>;
}
