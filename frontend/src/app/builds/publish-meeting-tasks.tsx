"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, UserPlus } from "lucide-react";
import { api } from "@/lib/portal/api";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ACTION_ITEM_SECTIONS, TASK_PRIORITIES, type DjangoUser, type MeetingActionItem } from "./_shared";

export function PublishMeetingTasks({ buildId, items, users, disabled }: { buildId: string; items: MeetingActionItem[]; users: DjangoUser[]; disabled: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<Record<number, string>>({});
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const dueDateInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const available = items.filter(i => !i.assigned_task_id && !i.superseded && ["REQUEST", "CHANGE"].includes(i.category) && !["DONE", "DROPPED"].includes(i.status));
  const selected = available.filter(i => i.id in selection);
  async function publish() {
    const dueDate = dueDateInput.current?.value || "";
    setBusy(true);
    try {
      const result = await api.post<{ created: number }>("builds/action-items/publish", {
        build: Number(buildId), items: selected.map(i => ({ id: i.id, assignee: Number(selection[i.id]), priority, due_date: dueDate ? new Date(`${dueDate}T17:00:00`).toISOString() : null })),
      });
      toast.success(`${result.created} tasks assigned. They are now in the task workspace.`);
      setSelection({}); setOpen(false); router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not assign tasks. Please retry."); }
    finally { setBusy(false); }
  }
  if (!available.length) return null;
  return <section className="rounded-xl border border-pink-200 bg-pink-50/40 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-900">Review first. Assign when ready.</h3><p className="mt-1 text-xs text-slate-600">{available.length} actionable suggestions. Questions and decisions stay in the meeting record.</p></div><Button type="button" onClick={() => setOpen(!open)} disabled={disabled || busy} aria-expanded={open}><UserPlus className="h-4 w-4" /> Review & assign</Button></div>
    {open && <div className="mt-5 space-y-4">
      <p className="text-xs text-slate-600">Confirm the wording below before assigning. Close this review to edit a suggestion in the checklist. Assigned items are protected from AI re-sync.</p>
      <fieldset disabled={busy || disabled} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-xs font-medium">Default assignee<Select value={assignee} onChange={e => { const value = e.target.value; setAssignee(value); setSelection(prev => Object.fromEntries(Object.keys(prev).map(id => [id, value]))); }}><option value="">Choose staff member</option>{users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}</Select></label>
          <label className="space-y-1 text-xs font-medium">Priority<Select value={priority} onChange={e => setPriority(e.target.value)}>{TASK_PRIORITIES.map(p => <option key={p} value={p}>{p.toLowerCase()}</option>)}</Select></label>
          <label className="space-y-1 text-xs font-medium">Due date<Input ref={dueDateInput} type="date" /></label>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={selected.length === available.length} onChange={e => setSelection(e.target.checked ? Object.fromEntries(available.map(i => [i.id, assignee])) : {})} /> Select all {available.length} suggestions</label>
        <div className="max-h-[480px] overflow-y-auto rounded-lg border border-slate-200 bg-white">
          {ACTION_ITEM_SECTIONS.map(section => {
            const rows = available.filter(i => i.section === section.key);
            return rows.length ? <div key={section.key}><h4 className="sticky top-0 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-500">{section.label}</h4>{rows.map(item => <div key={item.id} className="flex flex-wrap items-start gap-3 border-b border-slate-100 p-4"><label className="flex min-w-48 flex-1 items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={item.id in selection} onChange={e => setSelection(prev => { const next = { ...prev }; if (e.target.checked) next[item.id] = assignee; else delete next[item.id]; return next; })} /><span>{item.text}{item.detail && <span className="mt-1 block text-xs text-slate-500">{item.detail}</span>}</span></label><Select aria-label={`Assign ${item.text}`} className="w-44 text-xs" disabled={!(item.id in selection)} value={selection[item.id] || ''} onChange={e => setSelection(prev => ({ ...prev, [item.id]: e.target.value }))}><option value="">Choose staff</option>{users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}</Select></div>)}</div> : null;
          })}
        </div>
      </fieldset>
      {!users.length && <p role="alert" className="text-sm text-amber-700">No staff members are available. Check team permissions.</p>}
      <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Back to checklist</Button><Button onClick={publish} disabled={busy || disabled || !selected.length || selected.some(i => !selection[i.id])}>{busy ? 'Assigning…' : `Approve & assign ${selected.length} tasks`} <ArrowRight className="h-4 w-4" /></Button></div>
    </div>}
  </section>;
}
