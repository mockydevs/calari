"use client";

import { useState } from "react";
import { api } from "@/lib/portal/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type GhlStatus = {
  configured: boolean;
  location_id: string;
  checked_at: string | null;
  business_details?: Record<string, string>;
  last_check: {
    ok?: boolean;
    account?: string;
    error?: string;
    checks?: { area: string; ok: boolean; returned?: number; total?: number | null; limited?: boolean; error?: string }[];
  };
};

export function GhlConnectionForm({ clientId, initial }: { clientId: number; initial: GhlStatus }) {
  const [status, setStatus] = useState(initial);
  const [location, setLocation] = useState(initial.location_id);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const base = `projects/clients/${clientId}`;
  const dirty = location !== status.location_id || !!token;

  async function run(action: "save" | "test" | "disconnect") {
    if (action === "disconnect" && !window.confirm("Remove this client's stored GHL token and location? No data in GoHighLevel will be changed.")) return;
    setBusy(action); setError(""); setMessage("");
    try {
      if (action === "save") {
        const saved = await api.put<GhlStatus>(`${base}/ghl-connection`, { location_id: location.trim(), token: token.trim() });
        setStatus(saved); setLocation(saved.location_id); setToken("");
        setMessage("Credentials saved securely. Test the connection to verify access.");
      } else if (action === "test") {
        const tested = await api.post<GhlStatus>(`${base}/ghl-test`);
        setStatus(tested);
        setMessage(tested.last_check.ok ? "Connection verified. All four read checks passed." : "Connection test completed with access issues. See the results below.");
      } else {
        await api.del(`${base}/ghl-connection`);
        setStatus({ configured: false, location_id: "", checked_at: null, last_check: {} });
        setLocation(""); setToken(""); setMessage("Disconnected. Live GHL data was not changed.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The request failed. Please try again.");
    } finally { setBusy(""); }
  }

  return (
    <div className="space-y-5">
      {status.business_details?.name && <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="font-semibold text-slate-950">Business details imported from GHL</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {Object.entries(status.business_details).filter(([, value]) => !!value).map(([key, value]) => <div key={key}><dt className="text-xs capitalize text-slate-500">{key}</dt><dd className="break-words text-sm text-slate-800">{value}</dd></div>)}
        </dl>
      </section>}
      <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); void run("save"); }} className="space-y-5 rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-slate-950">Client connection</h2>
          <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">{!status.configured ? "Not configured" : !status.checked_at ? "Saved · not tested" : status.last_check.ok ? "Last test passed" : "Needs attention"}</span>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ghl-location">Location ID</Label>
          <Input id="ghl-location" value={location} onChange={(e) => setLocation(e.target.value)} required pattern="[A-Za-z0-9_-]{1,120}" maxLength={120} disabled={!!busy} autoComplete="off" />
          <p className="text-xs text-slate-500">Use the location ID from this client&apos;s GHL sub-account, not an agency ID or URL.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ghl-token">Private integration token</Label>
          <Input id="ghl-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} required={!status.configured || location !== status.location_id} maxLength={4096} autoComplete="new-password" disabled={!!busy} placeholder={status.configured ? "Leave blank to keep the saved token" : "Paste this location's token"} />
          <p className="text-xs text-slate-500">Encrypted on the server and never returned to the browser. Changing location requires its token.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={!!busy}>{busy === "save" ? "Saving…" : "Save connection"}</Button>
          <Button type="button" variant="outline" disabled={!!busy || !status.configured || dirty} onClick={() => void run("test")}>{busy === "test" ? "Testing read access…" : "Test connection"}</Button>
          {status.configured && <Button type="button" variant="ghost" disabled={!!busy} onClick={() => void run("disconnect")}>Disconnect</Button>}
        </div>
        {dirty && status.configured && <p className="text-xs text-slate-500">Save your changes before testing.</p>}
        {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </form>
      {status.checked_at && (
        <section className="rounded-lg border border-slate-200 bg-white p-6" aria-label="GHL test results">
          <h2 className="font-semibold text-slate-950">{status.last_check.account || "Connection test"}</h2>
          <p className="mt-1 text-xs text-slate-500">Last checked: {new Date(status.checked_at).toLocaleString()}. Repeat tests reuse results for 60 seconds.</p>
          {status.last_check.error && <p className="mt-3 text-sm text-red-700">{status.last_check.error}</p>}
          <ul className="mt-4 divide-y divide-slate-100">
            {status.last_check.checks?.map((check) => (
              <li key={check.area} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
                <span className="font-medium capitalize">{check.area}</span>
                <span className={check.ok ? "text-slate-600" : "text-red-700"}>{check.ok ? `${check.total ?? check.returned} ${check.total != null ? "total" : "returned"}${check.limited ? " · limited inventory" : ""}` : check.error}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="rounded-lg bg-slate-50 p-5 text-sm leading-6 text-slate-600">
        <p>Required read scopes: <code>locations.readonly</code>, <code>opportunities.readonly</code>, <code>locations/tags.readonly</code>, <code>forms.readonly</code>, <code>workflows.readonly</code>.</p>
        <p className="mt-2">Testing reads location identity and inventory only. No patient records, contacts, submissions or messages are read or changed. AI audits can use this inventory with either OpenAI or Claude, but names alone do not verify workflow behavior or a completed build.</p>
      </div>
    </div>
  );
}
