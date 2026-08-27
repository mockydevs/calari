"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/portal/api";
import { Button } from "@/components/ui/button";

type Connection = { connected: boolean; app_configured: boolean; workspace_id: string; user_id: string; scopes: string[]; redirect_uri: string; note: string };
export function SlackContextConnection() {
  const [data, setData] = useState<Connection | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; void api.get<Connection>("onboarding/slack/context").then(value => { if (live) setData(value); }).catch(err => { if (live) setError(err.message); }); return () => { live = false; }; }, []);
  async function connect() {
    setBusy(true); setError("");
    try { const result = await api.post<{ url: string }>("onboarding/slack/context/authorize"); window.location.assign(result.url); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not authorize Slack."); setBusy(false); }
  }
  return <section className="rounded-xl border border-slate-200 bg-white p-6">
    <h2 className="text-lg font-semibold">Slack context access</h2>
    <p className="mt-2 text-sm leading-6 text-slate-600">Final integration step: authorize Clare&apos;s user account through your approved internal Slack app. This is separate from the webhook and any posting bot. Only approved channels can supply staff context.</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {data && <><p className="mt-3 text-sm font-medium">{data.connected ? `Connected · ${data.workspace_id} · ${data.user_id}` : "Not connected — live Slack remains disconnected"}</p><p className="mt-2 text-xs text-slate-500">{data.note}</p>
      {!data.app_configured && <p className="mt-3 text-xs text-amber-800">Configure SLACK_APP_ID, SLACK_CLIENT_ID, SLACK_CLIENT_SECRET and SLACK_CONTEXT_REDIRECT_URI on the backend. Workspace approval and MCP access must be enabled in Slack.</p>}
      <div className="mt-4 flex gap-3"><Button disabled={busy || !data.app_configured} onClick={() => void connect()}>{data.connected ? "Reconnect user access" : "Connect Slack context"}</Button>
        {data.connected && <Button variant="outline" disabled={busy} onClick={async () => { if (!confirm("Disconnect Slack context and clear its derived evidence and drafts?")) return; setBusy(true); try { setData(await api.del<Connection>("onboarding/slack/context")); } catch (err) { setError(err instanceof Error ? err.message : "Disconnect failed."); } finally { setBusy(false); } }}>Disconnect</Button>}
      </div></>}
  </section>;
}
