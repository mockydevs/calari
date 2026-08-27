"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { api } from "@/lib/portal/api";
import { useToast, Spinner } from "@/components/toast";
import { createTask } from "../builds/actions";
import { TASK_PRIORITIES, TASK_TYPES, TASK_TYPE_LABEL, type DjangoClient, type DjangoUser } from "../builds/_shared";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type ClientBuild = { id: number; title: string };
export function QuickTaskForm({ clients, users }: { clients: DjangoClient[]; users: DjangoUser[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [clientId, setClientId] = React.useState("");
  const [builds, setBuilds] = React.useState<ClientBuild[]>([]);
  const [buildId, setBuildId] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const form = React.useRef<HTMLFormElement>(null);
  const titleInput = React.useRef<HTMLInputElement>(null);
  const trigger = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => { if (open) titleInput.current?.focus(); }, [open]);
  React.useEffect(() => {
    let current = true;
    if (!clientId) return;
    api.get<ClientBuild[] | { results: ClientBuild[] }>("builds/builds", { client: clientId, page_size: 200 })
      .then((data) => {
        if (!current) return;
        const list = Array.isArray(data) ? data : data.results;
        setBuilds(list);
        if (list.length === 1) setBuildId(String(list[0].id));
      })
      .catch(() => { if (current) setLoadError("Could not load builds. Select the client again to retry."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [clientId]);
  function close() { setOpen(false); trigger.current?.focus(); }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (clientId && !buildId) return;
    setSubmitting(true);
    try {
      const data = new FormData(event.currentTarget);
      data.set("buildId", buildId);
      const due = String(data.get("dueDate") || "");
      data.set("dueDate", due ? new Date(`${due}T17:00:00`).toISOString() : "");
      await createTask(data);
      toast.success("Task created and assigned.");
      form.current?.reset(); setClientId(""); setBuildId(""); setBuilds([]); close(); router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the task. Your draft is still here.");
    } finally { setSubmitting(false); }
  }
  return (
    <section id="new-task" className="scroll-mt-24">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5">
        <div><h2 className="font-semibold text-slate-900">Turn a to-do into an assignment</h2><p className="mt-1 text-sm text-slate-500">Internal work or client delivery. One place to assign it.</p></div>
        <Button ref={trigger} onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="task-composer"><Plus className="h-4 w-4" /> New task</Button>
      </div>
      {open && <form ref={form} id="task-composer" onSubmit={submit} className="mt-3 space-y-5 rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Create a task</h2><button type="button" onClick={close} disabled={submitting} aria-label="Close task form"><X className="h-5 w-5 text-slate-500" /></button></div>
        <fieldset disabled={submitting} className="grid gap-5 sm:grid-cols-2">
          <label className="space-y-2 text-sm font-medium sm:col-span-2">Task title<Input ref={titleInput} name="title" required maxLength={500} placeholder="What needs to get done?" /></label>
          <label className="space-y-2 text-sm font-medium sm:col-span-2">Description<Textarea name="description" rows={3} placeholder="Add context, expected outcome, or instructions…" /></label>
          <label className="space-y-2 text-sm font-medium">Assign to<Select name="assignee" required defaultValue=""><option value="" disabled>Select staff member</option>{users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}</Select></label>
          <label className="space-y-2 text-sm font-medium">Due date<Input name="dueDate" type="date" /></label>
          <label className="space-y-2 text-sm font-medium">Priority<Select name="priority" defaultValue="MEDIUM">{TASK_PRIORITIES.map(p => <option key={p} value={p}>{p[0] + p.slice(1).toLowerCase()}</option>)}</Select></label>
          <label className="space-y-2 text-sm font-medium">Category<Select name="type" defaultValue="OTHER">{TASK_TYPES.map(t => <option key={t} value={t}>{TASK_TYPE_LABEL[t]}</option>)}</Select></label>
          <label className="space-y-2 text-sm font-medium">Client (optional)<Select value={clientId} onChange={e => { setClientId(e.target.value); setBuildId(""); setBuilds([]); setLoadError(""); setLoading(Boolean(e.target.value)); }}><option value="">Internal task — no client</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></label>
          {clientId && <label className="space-y-2 text-sm font-medium">GHL build<Select required value={buildId} onChange={e => setBuildId(e.target.value)} disabled={loading}><option value="">{loading ? "Loading…" : "Select build"}</option>{builds.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}</Select></label>}
        </fieldset>
        {loadError && <p role="alert" className="text-sm text-red-700">{loadError}</p>}
        {clientId && !loading && !loadError && builds.length === 0 && <p className="text-sm text-amber-700">This client has no builds. Create a GHL build first or choose an internal task.</p>}
        {!users.length && <p role="alert" className="text-sm text-amber-700">No staff members available. Check your team and access permissions.</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={close} disabled={submitting}>Cancel</Button><Button type="submit" disabled={submitting || loading || Boolean(clientId && !buildId) || !users.length}>{submitting && <Spinner className="h-4 w-4" />} Create & assign</Button></div>
      </form>}
    </section>
  );
}
