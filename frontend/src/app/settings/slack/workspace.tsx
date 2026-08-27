"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/portal/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Select } from "@/components/ui/select";
import { TASK_TYPES, TASK_TYPE_LABEL, type DjangoUser } from "@/app/builds/_shared";

type Settings = { enabled: boolean; workspace_id: string; clare_user_id: string; secret_configured: boolean; webhook_path: string };
type Channel = { id: number; channel_id: string; name: string; client: number; client_name: string; active: boolean; context_enabled: boolean };
type Rule = { id: number; channel: number; category: string; assignee: number; assignee_name: string };
type Client = { id: number; name: string };
type Event = { id: number; channel_name: string; status: string; reason: string; received_at: string; text?: string; analysis?: unknown };
type Page<T> = { count: number; results: T[]; next: string | null; previous: string | null };
const list = <T,>(value: T[] | Page<T>) => Array.isArray(value) ? value : value.results;
const ROOT = "onboarding/slack";
const panel = "rounded-xl border border-slate-200 bg-white p-6";

export function SlackWorkspace() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [users, setUsers] = useState<DjangoUser[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [events, setEvents] = useState<Page<Event> | null>(null);
  const [preview, setPreview] = useState<Event | null>(null);
  const [status, setStatus] = useState("pending");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [destination, setDestination] = useState("");
  const generation = useRef(0);
  const refresh = useCallback(async (cancelled: () => boolean = () => false) => {
    const version = ++generation.current;
    const [config, mappings, responsibilities, roster, activity] = await Promise.all([
      api.get<Settings>(`${ROOT}/settings`), api.get<Channel[]>(`${ROOT}/channels`), api.get<Rule[]>(`${ROOT}/responsibilities`),
      api.get<DjangoUser[]>("builds/tasks/assignees"), api.get<Page<Event>>(`${ROOT}/events`, { status, page }),
    ]);
    if (cancelled() || version !== generation.current) return;
    setSettings(config); setChannels(mappings); setRules(responsibilities); setUsers(roster); setEvents(activity);
    setDestination(`${window.location.origin}${config.webhook_path}`);
  }, [status, page]);
  useEffect(() => {
    let alive = true;
    void refresh(() => !alive).catch((err: unknown) => { if (alive) setError(err instanceof Error ? err.message : "Could not load Slack routing."); });
    return () => { alive = false; };
  }, [refresh]);
  async function run(action: () => Promise<unknown>, message: string, reload = true) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); if (reload) await refresh(); setNotice(message); }
    catch (err) { setError(err instanceof Error ? err.message : "The request failed."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-6">
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</p>}
    {!settings && <Button variant="outline" disabled={busy} onClick={() => void run(refresh, "Loaded.", false)}>Load / retry settings</Button>}
    {settings && <>
      <section className={panel}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Connection</h2><span className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium">{settings.enabled ? "Intake enabled" : "Intake paused"} · {settings.secret_configured ? "Secret configured" : "Setup required"}</span></div>
        <p className="mt-3 text-sm leading-6 text-slate-600">Use an authorized Slack app with channel message subscriptions. The app can be visible to workspace administrators. This integration never posts to Slack. Enabling intake sends captured conversation text to the portal’s configured AI provider and shares relevant originals with assigned staff.</p>
        <label className="mt-4 block text-xs font-semibold">Events request URL<Input className="mt-1 font-mono text-xs" readOnly value={destination} /></label>
        {destination.startsWith("http:") && <p className="mt-2 text-xs text-amber-800">Local preview only. Slack needs this endpoint on the deployed portal’s public HTTPS domain.</p>}
        <form key={`${settings.workspace_id}-${settings.clare_user_id}-${settings.enabled}`} className="mt-5" onSubmit={event => {
          event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const secret = String(data.get("secret") || "").trim();
          void run(async () => { await api.patch(`${ROOT}/settings`, { workspace_id: String(data.get("workspace")), clare_user_id: String(data.get("clare")), enabled: data.get("enabled") === "on", ...(secret ? { signing_secret: secret } : {}) }); form.reset(); }, "Connection settings saved.");
        }}>
          <fieldset disabled={busy} className="grid gap-4 md:grid-cols-3">
            <label className="space-y-2 text-xs font-medium">Slack workspace ID<Input name="workspace" required defaultValue={settings.workspace_id} placeholder="T…" /></label>
            <label className="space-y-2 text-xs font-medium">Clare’s Slack member ID<Input name="clare" required defaultValue={settings.clare_user_id} placeholder="U…" /></label>
            <label className="space-y-2 text-xs font-medium">Signing secret<PasswordInput name="secret" autoComplete="new-password" placeholder={settings.secret_configured ? "Leave blank to retain" : "From Slack app settings"} /></label>
            <label className="flex items-center gap-2 text-sm md:col-span-2"><input name="enabled" type="checkbox" defaultChecked={settings.enabled} />Enable capture and automatic staff routing</label><Button type="submit">Save connection</Button>
          </fieldset>
        </form>
      </section>
      <section className={panel}>
        <h2 className="text-lg font-semibold">Channels & responsibilities</h2><p className="mt-2 text-sm text-slate-600">For example: Checkpilot → Don for automation, pipelines and tags; Anita for forms and funnels. Uncertain requests go to this channel’s assigned staff, not Clare.</p>
        <div className="mt-5 space-y-4">{channels.map(channel => <article key={channel.id} className="rounded-lg border border-slate-200 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{channel.name} <span className="text-xs font-normal text-slate-400">{channel.channel_id}</span></h3><p className="mt-1 text-xs text-slate-500">{channel.client_name} · {channel.active ? "Active" : "Paused"}</p></div><Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => api.patch(`${ROOT}/channels/${channel.id}`, { active: !channel.active }), "Channel updated.")}>{channel.active ? "Pause channel" : "Resume channel"}</Button></div>
          <div className="mt-3 divide-y divide-slate-100">{rules.filter(rule => rule.channel === channel.id).map(rule => <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"><span>{TASK_TYPE_LABEL[rule.category] || rule.category} <span className="mx-2 text-slate-300">→</span> {rule.assignee_name || users.find(user => user.id === rule.assignee)?.username}</span><Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => api.del(`${ROOT}/responsibilities/${rule.id}`), "Responsibility removed. Existing task assignments are preserved.")}>Remove</Button></div>)}</div>
          <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-600"><input type="checkbox" checked={channel.context_enabled} disabled={busy} onChange={event => { const enabled = event.target.checked; if (enabled && !confirm("Authorize this channel and this client's build context to be processed by AI and shared with the assigned portal staff? Confirm you have permission to share it.")) return; void run(() => api.patch(`${ROOT}/channels/${channel.id}`, { context_enabled: enabled }), "Context authorization updated. Previous derived context was cleared."); }} />Authorize additional Slack and client context for assigned portal staff</label>
          {!rules.some(rule => rule.channel === channel.id) && <p className="mt-3 text-xs text-amber-800">Assign staff before enabling this channel. Captured requests cannot route without an owner.</p>}
          <form className="mt-3" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); const category = String(data.get("category")); const existing = rules.find(rule => rule.channel === channel.id && rule.category === category); void run(() => existing ? api.patch(`${ROOT}/responsibilities/${existing.id}`, { assignee: Number(data.get("assignee")) }) : api.post(`${ROOT}/responsibilities`, { channel: channel.id, category, assignee: Number(data.get("assignee")) }), "Responsibility saved. New work follows this mapping; existing task owners are preserved."); }}>
            <fieldset disabled={busy} className="flex flex-wrap items-end gap-3"><label className="min-w-36 flex-1 space-y-1 text-xs font-medium">Responsibility<Select name="category">{TASK_TYPES.map(type => <option key={type} value={type}>{TASK_TYPE_LABEL[type]}</option>)}</Select></label><label className="min-w-36 flex-1 space-y-1 text-xs font-medium">Point person<Select name="assignee" required defaultValue=""><option value="" disabled>Choose staff</option>{users.map(user => <option key={user.id} value={user.id}>{user.full_name || user.username}</option>)}</Select></label><Button type="submit" size="sm" variant="outline">Save responsibility</Button></fieldset>
          </form>
        </article>)}</div>
        <details className="mt-5 rounded-lg bg-slate-50 p-4"><summary className="cursor-pointer text-sm font-semibold">Map a Slack channel</summary>
          <form className="mt-4 flex items-end gap-3" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void run(async () => setClients(list(await api.get<Client[] | Page<Client>>("projects/clients", { search: String(data.get("search")) }))), "Account matches loaded.", false); }}><label className="flex-1 space-y-1 text-xs font-medium">Find account<Input name="search" placeholder="Search client name" /></label><Button size="sm" variant="outline" type="submit" disabled={busy}>Find account</Button></form>
          <form className="mt-4" onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); void run(async () => { await api.post(`${ROOT}/channels`, { channel_id: String(data.get("channel_id")), name: String(data.get("name")), client: Number(data.get("client")), active: false }); form.reset(); }, "Channel mapped and paused. Add responsibilities, then resume it."); }}>
            <fieldset disabled={busy} className="grid gap-3 md:grid-cols-3"><label className="space-y-1 text-xs font-medium">Account<Select name="client" required defaultValue=""><option value="" disabled>Select a search result</option>{clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</Select></label><label className="space-y-1 text-xs font-medium">Slack channel ID<Input required name="channel_id" placeholder="C…" /></label><label className="space-y-1 text-xs font-medium">Display name<Input required name="name" placeholder="Checkpilot" maxLength={120} /></label><Button type="submit" variant="outline">Add channel</Button></fieldset>
          </form>
        </details>
      </section>
      <section className={panel}>
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Delivery activity</h2><p className="mt-1 text-xs text-slate-500">Operational visibility only. Staff receive work without approval.</p></div><div className="flex gap-3"><Select aria-label="Delivery status" disabled={busy} value={status} onChange={event => { setStatus(event.target.value); setPage(1); setPreview(null); }}><option value="pending">Awaiting analysis</option><option value="routed">Assigned to staff</option><option value="needs_setup">Routing setup needed</option><option value="ignored">No action</option></Select><Button variant="outline" disabled={busy} onClick={() => void run(refresh, "Refreshed.", false)}>Refresh</Button></div></div>
        <div className="mt-4 divide-y divide-slate-100">{events?.results.map(event => <article key={event.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><h3 className="text-sm font-semibold">{event.channel_name} · Request #{event.id}</h3><p className="mt-1 text-xs text-slate-500">{event.reason || "Waiting for the background worker."}</p></div><div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => setPreview(await api.get<Event>(`${ROOT}/events/${event.id}`)), "", false)}>View source</Button>{event.status === "needs_setup" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => api.post(`${ROOT}/events/${event.id}/retry`, {}), "Queued for routing.")}>Retry routing</Button>}</div></article>)}</div>
        {events && !events.count && <p className="py-8 text-center text-sm text-slate-500">No requests in this view.</p>}
        <div className="mt-3 flex items-center gap-3 text-sm"><span className="text-slate-500">Page {page}</span>{events?.previous && <Button size="sm" variant="outline" disabled={busy} onClick={() => setPage(page - 1)}>Previous</Button>}{events?.next && <Button size="sm" variant="outline" disabled={busy} onClick={() => setPage(page + 1)}>Next</Button>}</div>
        {preview && <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Original message · Request #{preview.id}</h3><Button size="sm" variant="ghost" onClick={() => setPreview(null)}>Close source</Button></div><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{preview.text}</p><details className="mt-4"><summary className="cursor-pointer text-xs text-slate-500">Analysis record</summary><pre className="mt-3 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(preview.analysis, null, 2)}</pre></details></div>}
      </section>
    </>}
  </div>;
}
