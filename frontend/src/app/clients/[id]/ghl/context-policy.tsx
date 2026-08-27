"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/portal/api";
import { Button } from "@/components/ui/button";

type Policy = { enabled: boolean; allow_record_reads: boolean; retention_days: number; limits: string; capabilities: Record<string, unknown> | null };
export function ContextPolicy({ clientId }: { clientId: number }) {
  const [data, setData] = useState<Policy | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const root = `onboarding/clients/${clientId}/context-policy`;
  useEffect(() => { let live = true; void api.get<Policy>(root).then(value => { if (live) setData(value); }).catch(err => { if (live) setError(err.message); }); return () => { live = false; }; }, [root]);
  async function update(capabilities = false) {
    setBusy(true); setError("");
    try { setData(capabilities ? await api.post<Policy>(root) : await api.patch<Policy>(root, { enabled: data?.enabled, allow_record_reads: data?.allow_record_reads, retention_days: data?.retention_days })); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not update context settings."); }
    finally { setBusy(false); }
  }
  return <section className="rounded-lg border border-slate-200 bg-white p-5">
    <h2 className="font-semibold">Client investigations</h2><p className="mt-2 text-sm leading-6 text-slate-500">Authorize evidence for assigned staff. Channel context requires separate approval in Slack settings. Changes clear previous evidence and drafts.</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {data && <fieldset disabled={busy} className="mt-4 space-y-4 text-sm">
      <label className="flex items-start gap-2"><input type="checkbox" checked={data.enabled} onChange={event => setData({ ...data, enabled: event.target.checked })} />Enable background client investigations</label>
      <label className="flex items-start gap-2"><input type="checkbox" checked={data.allow_record_reads} onChange={event => setData({ ...data, allow_record_reads: event.target.checked })} />Allow exact contact ID and tag reads. No contact details, clinical records or conversations are retrieved.</label>
      <label className="block">Context retention (1–90 days)<input type="number" min={1} max={90} value={data.retention_days} onChange={event => setData({ ...data, retention_days: Number(event.target.value) })} className="ml-3 w-20 rounded border border-slate-200 px-2 py-1" /></label>
      <p className="text-xs text-slate-500">{data.limits}</p>
      <div className="flex gap-3"><Button size="sm" onClick={() => void update()}>Save context policy</Button><Button size="sm" variant="outline" onClick={() => void update(true)}>Check MCP capabilities</Button></div>
      {data.capabilities && <pre className="overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs leading-5">{JSON.stringify(data.capabilities, null, 2)}</pre>}
    </fieldset>}
  </section>;
}
