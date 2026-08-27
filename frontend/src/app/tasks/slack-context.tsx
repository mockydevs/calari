"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/portal/api";
import { Button } from "@/components/ui/button";

type Message = { id: number; original: string; sender_id: string; message_ts: string; channel_name: string; interpretation: string; category: string; kind: string; received_at: string };
type Page = { results: Message[]; next: string | null; previous: string | null; count: number };

export function SlackContext({ taskId, embedded = false }: { taskId: number; embedded?: boolean }) {
  const [open, setOpen] = useState(embedded);
  const [data, setData] = useState<Page | null>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(embedded);
  const [error, setError] = useState("");
  const load = useCallback(async (nextPage = 1) => {
    setBusy(true); setError("");
    try { const result = await api.get<Page>(`builds/tasks/${taskId}/slack-context`, { page: nextPage }); setData(result); setPage(nextPage); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not load Slack context."); }
    finally { setBusy(false); }
  }, [taskId]);
  useEffect(() => {
    if (!embedded) return;
    let active = true;
    void api.get<Page>(`builds/tasks/${taskId}/slack-context`, { page: 1 })
      .then(result => { if (active) setData(result); })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : "Could not load messages."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [embedded, taskId]);
  return <section className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
    {!embedded && <button type="button" className="text-sm font-semibold text-slate-800" aria-expanded={open} onClick={() => { setOpen(!open); if (!open && !data && !busy) void load(); }}>Slack context · original messages & AI interpretation</button>}
    {open && <div className="mt-4 space-y-4">
      <p className="text-xs text-slate-500">Newest first. AI interpretation may be incomplete; use the original message and your knowledge of the build. Nothing here posts a reply to Slack.</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {busy && <p role="status" className="text-sm text-slate-500">Loading messages…</p>}
      {data?.results.map(message => <article key={message.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 text-xs text-slate-500">{message.channel_name} · {message.category.toLowerCase()} · {message.kind} · {new Date(message.received_at).toLocaleString()}</div>
        <div className="grid gap-0 lg:grid-cols-2">
          <div className="p-4"><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Original Slack message</h3><p className="mt-1 text-xs text-slate-400">Sender {message.sender_id} · {message.message_ts}</p><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">{message.original}</p></div>
          <div className="border-t border-slate-100 bg-slate-50/50 p-4 lg:border-t-0 lg:border-l"><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">AI interpretation</h3><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{message.interpretation}</p></div>
        </div>
      </article>)}
      {data && !data.count && <p className="text-sm text-slate-500">No messages available.</p>}
      <div className="flex flex-wrap gap-3"><Button size="sm" variant="outline" disabled={busy} onClick={() => void load(page)}>Refresh</Button>{data?.previous && <Button size="sm" variant="outline" disabled={busy} onClick={() => void load(page - 1)}>Previous</Button>}{data?.next && <Button size="sm" variant="outline" disabled={busy} onClick={() => void load(page + 1)}>Next</Button>}</div>
    </div>}
  </section>;
}
