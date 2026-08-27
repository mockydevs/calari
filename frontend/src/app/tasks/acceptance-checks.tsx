"use client";
import { useState } from "react";
import { api } from "@/lib/portal/api";
import { Button } from "@/components/ui/button";

type Check = { area: string; record_id: string; field: string; expected: string };
export function AcceptanceChecks({ taskId }: { taskId: number }) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    try { setChecks((await api.get<{ checks: Check[] }>(`builds/tasks/${taskId}/ghl-acceptance`)).checks); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not load checks."); }
    finally { setBusy(false); }
  }
  return <details className="rounded-lg border border-slate-200 p-3" onToggle={event => { if (event.currentTarget.open && !checks && !busy) void load(); }}>
    <summary className="cursor-pointer text-sm font-semibold">Explicit acceptance checks</summary>
    <p className="mt-2 text-xs leading-5 text-slate-500">Use exact IDs from the evidence above. These checks verify resource presence or a specific field; they do not test execution, wiring or submissions. Saving on a completed task queues a fresh check.</p>
    {checks?.map((check, index) => <div key={index} className="mt-3 grid gap-2 sm:grid-cols-2">
      <select aria-label={`Check ${index + 1} area`} className="rounded border p-2 text-xs" value={check.area} onChange={event => setChecks(checks.map((row, i) => i === index ? { ...row, area: event.target.value } : row))}>{["pipelines", "tags", "forms", "workflows", "customFields"].map(area => <option key={area}>{area}</option>)}</select>
      <input aria-label={`Check ${index + 1} resource ID`} className="rounded border p-2 text-xs" placeholder="Exact resource ID" value={check.record_id} maxLength={120} onChange={event => setChecks(checks.map((row, i) => i === index ? { ...row, record_id: event.target.value } : row))} />
      <select aria-label={`Check ${index + 1} field`} className="rounded border p-2 text-xs" value={check.field} onChange={event => setChecks(checks.map((row, i) => i === index ? { ...row, field: event.target.value } : row))}><option value="exists">Resource exists</option><option value="name">Name equals</option><option value="status">Status equals</option></select>
      <input aria-label={`Check ${index + 1} expected value`} className="rounded border p-2 text-xs" placeholder="Expected value" disabled={check.field === "exists"} value={check.expected} maxLength={160} onChange={event => setChecks(checks.map((row, i) => i === index ? { ...row, expected: event.target.value } : row))} />
      <Button size="sm" variant="ghost" onClick={() => setChecks(checks.filter((_, i) => i !== index))}>Remove check</Button>
    </div>)}
    {checks && <div className="mt-3 flex gap-2"><Button size="sm" variant="outline" disabled={busy || checks.length >= 8} onClick={() => setChecks([...checks, { area: "workflows", record_id: "", field: "exists", expected: "" }])}>Add check</Button><Button size="sm" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await api.put(`builds/tasks/${taskId}/ghl-acceptance`, { checks }); setError("Checks saved. Completion results appear under GHL verification."); } catch (err) { setError(err instanceof Error ? err.message : "Could not save checks."); } finally { setBusy(false); } }}>Save checks</Button></div>}
    {error && <p role="status" className="mt-2 text-xs">{error}</p>}
  </details>;
}
