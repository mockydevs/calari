"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/portal/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PasswordInput } from "@/components/ui/password-input";

type Settings = { enabled: boolean; secret_configured: boolean; webhook_path: string; pending_count: number };
type Rule = { id: number; participant_email: string; build: number; build_title: string; client_name: string; active: boolean };
type Build = { id: number; title: string; client_name: string };
type Meeting = {
  id: number; title: string; participant_emails: string[]; status: string; routing_reason: string;
  occurred_at: string | null; received_at: string; recording_url: string; build: number | null; build_title: string | null;
  summary?: string; transcript?: string; action_items?: string[];
};
type Page<T> = { count: number; results: T[]; next: string | null; previous: string | null };
const list = <T,>(value: T[] | Page<T>): T[] => Array.isArray(value) ? value : value.results;
const ROOT = "onboarding/fathom";

export function FathomWorkspace() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [builds, setBuilds] = useState<Build[]>([]);
  const [meetings, setMeetings] = useState<Page<Meeting> | null>(null);
  const [status, setStatus] = useState("pending");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<Meeting | null>(null);
  const [destination, setDestination] = useState("");
  const requestVersion = useRef(0);

  const refresh = useCallback(async (cancelled: () => boolean = () => false) => {
    const version = ++requestVersion.current;
    const [config, routeRules, targets, inbox] = await Promise.all([
      api.get<Settings>(`${ROOT}/settings`),
      api.get<Rule[] | Page<Rule>>(`${ROOT}/rules`),
      api.get<Build[] | Page<Build>>("builds/my-builds"),
      api.get<Page<Meeting>>(`${ROOT}/meetings`, { status, page }),
    ]);
    if (cancelled() || version !== requestVersion.current) return;
    setSettings(config); setRules(list(routeRules)); setBuilds(list(targets)); setMeetings(inbox);
    setDestination(`${window.location.origin}${config.webhook_path}`);
  }, [status, page]);

  useEffect(() => {
    let alive = true;
    void refresh(() => !alive).catch((err: unknown) => {
      if (alive) setError(err instanceof Error ? err.message : "Could not load Fathom settings.");
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [refresh]);

  async function run(action: () => Promise<unknown>, message: string, reload = true) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); if (reload) await refresh(); setNotice(message); }
    catch (err) { setError(err instanceof ApiError || err instanceof Error ? err.message : "The request failed."); }
    finally { setBusy(false); }
  }

  const targetOptions = builds.map(build => <option key={build.id} value={build.id}>{build.client_name} · {build.title}</option>);

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</p>}
      {loading && <p role="status" className="text-sm text-slate-500">Loading Fathom workspace…</p>}
      {!settings && !loading && <Button onClick={() => void run(refresh, "Loaded.", false)} disabled={busy}>Retry</Button>}
      {settings && <>
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Connection</h2>
            <span className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium">{settings.enabled ? "Imports enabled" : "Imports paused"} · {settings.secret_configured ? "Signing secret saved" : "Setup required"}</span>
          </div>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600">
            <li>In <a href="https://fathom.video/customize" target="_blank" rel="noreferrer" className="font-medium text-pink-700 underline">Fathom settings</a>, open API Access, generate an API key, then choose Manage → Add Webhook. You do not need to save the API key in Calari.</li>
            <li>Use the destination below. Select only the recordings you want copied into this workspace; include the transcript, summary, and action items.</li>
            <li>Copy Fathom’s webhook signing secret into the field below and enable imports. Only new meeting deliveries are imported; this does not backfill history.</li>
          </ol>
          <label htmlFor="fathom-destination" className="mt-4 block text-xs font-semibold text-slate-700">Webhook destination</label>
          <Input id="fathom-destination" value={destination} readOnly className="mt-1 font-mono text-xs" />
          {destination.startsWith("http:") && <p className="mt-2 text-xs text-amber-800">This local URL cannot receive Fathom deliveries. After deployment, use this path on your public HTTPS portal domain.</p>}
          <form className="mt-5 flex flex-wrap items-end gap-4" onSubmit={event => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const secret = String(data.get("webhook_secret") ?? "").trim();
            void run(async () => {
              await api.patch(`${ROOT}/settings`, { enabled: data.get("enabled") === "on", ...(secret ? { webhook_secret: secret } : {}) });
              form.reset();
            }, "Fathom settings saved.");
          }}>
            <div className="min-w-64 flex-1 space-y-1">
              <label htmlFor="fathom-secret" className="text-xs font-semibold">Webhook signing secret</label>
              <PasswordInput id="fathom-secret" name="webhook_secret" placeholder={settings.secret_configured ? "Leave blank to keep the saved secret" : "whsec_…"} autoComplete="new-password" />
              <p className="text-xs text-slate-500">Encrypted at rest. Never returned by the API.</p>
            </div>
            <label className="flex h-10 items-center gap-2 text-sm" key={String(settings.enabled)}><input type="checkbox" name="enabled" defaultChecked={settings.enabled} /> Enable automatic imports</label>
            <Button disabled={busy} type="submit">Save connection</Button>
          </form>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold">Route meetings to a client build</h2>
          <p className="mt-2 text-sm text-slate-600">Match an exact participant email to a GHL build. Conflicting matches stay in the inbox. Use client contacts, not staff who attend many clients’ meetings. New rules apply to future deliveries.</p>
          <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={event => {
            event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
            void run(async () => { await api.post(`${ROOT}/rules`, { participant_email: data.get("email"), build: Number(data.get("build")), active: true }); form.reset(); }, "Routing rule added.");
          }}>
            <Input name="email" type="email" required aria-label="Client participant email" placeholder="contact@client.com" />
            <Select name="build" required aria-label="Routing destination build" defaultValue=""><option value="" disabled>Select a client build</option>{targetOptions}</Select>
            <Button type="submit" disabled={busy || !builds.length}>Add rule</Button>
          </form>
          {!builds.length && <p className="mt-2 text-sm text-slate-500"><Link href="/builds/new" className="text-pink-700 underline">Create a client build</Link> before adding a routing rule.</p>}
          <ul className="mt-4 divide-y divide-slate-100">
            {rules.map(rule => <li key={rule.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div><p className="font-medium">{rule.participant_email}</p><p className="text-xs text-slate-500">{rule.client_name} · {rule.build_title} · {rule.active ? "Active" : "Paused"}</p></div>
              <div className="flex gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => api.patch(`${ROOT}/rules/${rule.id}`, { active: !rule.active }), "Routing rule updated.")}>{rule.active ? "Pause" : "Resume"}</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => api.del(`${ROOT}/rules/${rule.id}`), "Routing rule removed.")}>Remove</Button></div>
            </li>)}
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-lg font-semibold">Meeting inbox</h2><p className="mt-1 text-sm text-slate-500">{settings.pending_count} awaiting routing. Imported notes stay subject to the normal task review process.</p></div>
            <div className="flex gap-2"><Select aria-label="Meeting status" disabled={busy} value={status} onChange={event => { setStatus(event.target.value); setPage(1); setPreview(null); }}><option value="pending">Needs routing</option><option value="attached">Added to build</option><option value="ignored">Ignored</option></Select><Button variant="outline" disabled={busy} onClick={() => void run(refresh, "Inbox refreshed.", false)}>Refresh</Button></div>
          </div>
          {meetings?.results.length === 0 && <p className="mt-6 rounded-lg bg-slate-50 p-6 text-sm text-slate-500">No meetings in this view. New deliveries will appear after Fathom is connected.</p>}
          <ul className="mt-4 divide-y divide-slate-100">
            {meetings?.results.map(meeting => <li key={meeting.id} className="space-y-3 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{meeting.title}</h3><p className="mt-1 text-xs text-slate-500">{new Date(meeting.occurred_at ?? meeting.received_at).toLocaleString()} · {meeting.participant_emails.join(", ") || "No participant emails"}</p>{meeting.routing_reason && <p className="mt-1 text-xs text-amber-800">{meeting.routing_reason}</p>}</div><Button variant="outline" size="sm" disabled={busy} onClick={() => void run(async () => setPreview(await api.get<Meeting>(`${ROOT}/meetings/${meeting.id}`)), "Meeting preview loaded.", false)}>Preview notes</Button></div>
              {meeting.build && <Link href={`/builds/${meeting.build}`} className="text-sm font-medium text-pink-700">Open {meeting.build_title}</Link>}
              {meeting.status === "attached" && !meeting.build && <p className="text-xs text-slate-500">The linked build or note was removed. This recording will not be imported again.</p>}
              {meeting.status === "pending" && <form className="flex flex-wrap gap-2" onSubmit={event => {
                event.preventDefault(); const data = new FormData(event.currentTarget);
                void run(() => api.post(`${ROOT}/meetings/${meeting.id}/attach`, { build: Number(data.get("build")) }), "Meeting added to the build. Review its task list before assigning staff.");
              }}><Select name="build" required aria-label={`Build for ${meeting.title}`} defaultValue="" className="max-w-md"><option value="" disabled>Select destination build</option>{targetOptions}</Select><Button type="submit" size="sm" disabled={busy}>Add to build</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => api.post(`${ROOT}/meetings/${meeting.id}/ignore`, {}), "Meeting ignored; it will not be imported on resend.")}>Ignore</Button></form>}
            </li>)}
          </ul>
          {meetings && <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 text-xs text-slate-500"><span>{meetings.count} meetings · Page {page}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={!meetings.previous || busy} onClick={() => setPage(value => value - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={!meetings.next || busy} onClick={() => setPage(value => value + 1)}>Next</Button></div></div>}
          {preview && <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4"><div className="flex items-center justify-between"><h3 className="font-semibold">{preview.title}</h3><Button variant="ghost" size="sm" onClick={() => setPreview(null)}>Close preview</Button></div>{preview.recording_url && <a href={preview.recording_url} target="_blank" rel="noreferrer" className="text-sm text-pink-700 underline">Open Fathom recording</a>}<pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-6 text-slate-700">{[preview.summary, preview.action_items?.map(item => `- ${item}`).join("\n"), preview.transcript].filter(Boolean).join("\n\n")}</pre></div>}
        </section>
      </>}
    </div>
  );
}
