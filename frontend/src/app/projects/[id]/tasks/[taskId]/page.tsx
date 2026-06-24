import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, ListChecks, MessageSquare, Plus, ShieldAlert, Tag, Trash2 } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import {
  PRIORITIES, PRIORITY_LABELS, TASK_STATUS_LABELS, TASK_STATUSES, type Priority, type TaskStatus,
} from "@/lib/portal/types";
import {
  addChecklistItem, addTaskBlocker, addTaskComment, deleteChecklistItem, deleteTask,
  resolveTaskBlocker, toggleChecklistItem, updateTask,
} from "../../../actions";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Label = { id: number; name: string; color: string };
type TaskDetail = {
  id: number; name: string; description: string; status: TaskStatus; priority: Priority;
  due_date: string | null; assigned_to: number | null; assigned_to_name?: string;
  checklist?: { id: number; title: string; completed: boolean }[];
  comments?: { id: number; content: string; author_name?: string; created_at: string }[];
  blockers?: { id: number; description: string; resolved: boolean }[];
  labels?: Label[];
};
type UserRow = { id: number; full_name?: string; username?: string };

function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

const STATUS_STYLE: Record<string, string> = {
  todo: "bg-slate-100 text-slate-600 ring-slate-200",
  in_progress: "bg-amber-50 text-amber-700 ring-amber-200",
  in_review: "bg-violet-50 text-violet-700 ring-violet-200",
  done: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};
const field = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:border-pink-500 focus:outline-none focus:ring-2 focus:ring-pink-500/30";
const addInput = "h-9 flex-1 rounded-md border border-slate-300 px-2.5 text-sm focus:border-pink-500 focus:outline-none focus:ring-2 focus:ring-pink-500/30";

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5 text-sm font-semibold text-slate-950">{icon}{title}</div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string; taskId: string }> }) {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const { id, taskId } = await params;

  const task = await serverApi.get<TaskDetail>(`projects/tasks/${taskId}`).catch(() => null);
  if (!task) notFound();

  const [labels, users] = await Promise.all([
    serverApi.get<Label[] | { results: Label[] }>("projects/task-labels").then(asList).catch(() => [] as Label[]),
    isAdmin ? serverApi.get<UserRow[] | { results: UserRow[] }>("auth/users").then(asList).catch(() => [] as UserRow[]) : Promise.resolve([] as UserRow[]),
  ]);

  const checklist = task.checklist ?? [];
  const done = checklist.filter((c) => c.completed).length;
  const comments = task.comments ?? [];
  const activeBlockers = (task.blockers ?? []).filter((b) => !b.resolved);
  const attachedLabelIds = new Set((task.labels ?? []).map((l) => l.id));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <Link href={`/projects/${id}/board`} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Task board
      </Link>

      <div className="rounded-lg border border-slate-200/80 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset ${STATUS_STYLE[task.status] ?? ""}`}>{TASK_STATUS_LABELS[task.status]}</span>
          <span className="text-xs font-medium capitalize text-slate-500">{PRIORITY_LABELS[task.priority]} priority</span>
          {(task.labels ?? []).map((l) => (
            <span key={l.id} className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: l.color }}>
              <Tag className="h-3 w-3" /> {l.name}
            </span>
          ))}
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{task.name}</h1>
        <p className="mt-1 text-sm text-slate-500">Assignee: {task.assigned_to_name || "Unassigned"}{task.due_date ? ` · Due ${task.due_date}` : ""}</p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        {/* Edit */}
        <Panel title="Details" icon={<ListChecks className="h-4 w-4 text-pink-700" />}>
          <form action={updateTask} className="space-y-3.5">
            <input type="hidden" name="taskId" value={taskId} />
            <input type="hidden" name="projectId" value={id} />
            <div className="space-y-1.5"><label className="text-sm font-medium text-slate-700">Name</label><input name="name" required defaultValue={task.name} className={field} /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><label className="text-sm font-medium text-slate-700">Status</label>
                <select name="status" defaultValue={task.status} className={field}>{TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}</select>
              </div>
              <div className="space-y-1.5"><label className="text-sm font-medium text-slate-700">Priority</label>
                <select name="priority" defaultValue={task.priority} className={field}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}</select>
              </div>
              <div className="space-y-1.5"><label className="text-sm font-medium text-slate-700">Assignee</label>
                <select name="assigned_to" defaultValue={task.assigned_to ?? ""} className={field} disabled={!isAdmin}>
                  <option value="">— Unassigned —</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
                </select>
              </div>
              <div className="space-y-1.5"><label className="text-sm font-medium text-slate-700">Due date</label><input name="due_date" type="date" defaultValue={task.due_date ?? ""} className={field} /></div>
            </div>
            <div className="space-y-1.5"><label className="text-sm font-medium text-slate-700">Description</label><textarea name="description" rows={3} defaultValue={task.description} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none focus:ring-2 focus:ring-pink-500/30" /></div>
            {labels.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Labels</label>
                <div className="flex flex-wrap gap-2">
                  {labels.map((l) => (
                    <label key={l.id} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-xs">
                      <input type="checkbox" name="labels" value={l.id} defaultChecked={attachedLabelIds.has(l.id)} className="accent-pink-600" />
                      {l.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between pt-1">
              <Button type="submit" size="sm">Save changes</Button>
              {isAdmin && (
                <form action={deleteTask}>
                  <input type="hidden" name="taskId" value={taskId} />
                  <input type="hidden" name="projectId" value={id} />
                  <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-200 px-3 text-xs font-semibold text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /> Delete task</button>
                </form>
              )}
            </div>
          </form>
        </Panel>

        <div className="space-y-5">
          {/* Checklist */}
          <Panel title={`Checklist (${done}/${checklist.length})`} icon={<Check className="h-4 w-4 text-pink-700" />}>
            {checklist.length === 0 ? <p className="text-sm text-slate-400">No checklist items.</p> : (
              <ul className="space-y-1.5">
                {checklist.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                    <form action={toggleChecklistItem} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={c.id} /><input type="hidden" name="taskId" value={taskId} /><input type="hidden" name="projectId" value={id} /><input type="hidden" name="completed" value={String(c.completed)} />
                      <button className={`flex h-5 w-5 items-center justify-center rounded border ${c.completed ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 text-transparent hover:border-pink-500"}`}><Check className="h-3.5 w-3.5" /></button>
                      <span className={c.completed ? "text-slate-400 line-through" : "text-slate-800"}>{c.title}</span>
                    </form>
                    <form action={deleteChecklistItem}>
                      <input type="hidden" name="id" value={c.id} /><input type="hidden" name="taskId" value={taskId} /><input type="hidden" name="projectId" value={id} />
                      <button className="text-slate-300 hover:text-red-600" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <form action={addChecklistItem} className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
              <input type="hidden" name="taskId" value={taskId} /><input type="hidden" name="projectId" value={id} />
              <input name="title" required placeholder="Add item…" className={addInput} />
              <button className="inline-flex h-9 items-center gap-1 rounded-md bg-pink-700 px-2.5 text-xs font-semibold text-white hover:bg-pink-800"><Plus className="h-3.5 w-3.5" /></button>
            </form>
          </Panel>

          {/* Blockers */}
          <Panel title="Blockers" icon={<ShieldAlert className="h-4 w-4 text-red-600" />}>
            {activeBlockers.length === 0 ? <p className="text-sm text-slate-400">No active blockers.</p> : (
              <ul className="space-y-2">
                {activeBlockers.map((b) => (
                  <li key={b.id} className="flex items-start justify-between gap-2 rounded-md bg-red-50 p-2.5 text-sm text-red-800">
                    <span>{b.description}</span>
                    <form action={resolveTaskBlocker}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="taskId" value={taskId} /><input type="hidden" name="projectId" value={id} /><button className="shrink-0 rounded px-1.5 text-xs font-semibold text-red-700 hover:bg-red-100">Resolve</button></form>
                  </li>
                ))}
              </ul>
            )}
            <form action={addTaskBlocker} className="mt-3 flex items-center gap-2 border-t border-red-100 pt-3">
              <input type="hidden" name="taskId" value={taskId} /><input type="hidden" name="projectId" value={id} />
              <input name="description" required placeholder="Report a blocker…" className={addInput} />
              <button className="inline-flex h-9 items-center gap-1 rounded-md bg-red-600 px-2.5 text-xs font-semibold text-white hover:bg-red-700"><Plus className="h-3.5 w-3.5" /></button>
            </form>
          </Panel>
        </div>
      </div>

      {/* Comments */}
      <Panel title={`Comments (${comments.length})`} icon={<MessageSquare className="h-4 w-4 text-pink-700" />}>
        {comments.length === 0 ? <p className="text-sm text-slate-400">No comments yet.</p> : (
          <ul className="space-y-3">
            {comments.map((c) => (
              <li key={c.id} className="rounded-md bg-slate-50 p-3 text-sm">
                <div className="mb-0.5 flex items-center justify-between text-xs text-slate-400"><span className="font-semibold text-slate-700">{c.author_name || "Someone"}</span><span>{formatDate(c.created_at)}</span></div>
                <p className="text-slate-700">{c.content}</p>
              </li>
            ))}
          </ul>
        )}
        <form action={addTaskComment} className="mt-3 flex items-start gap-2 border-t border-slate-100 pt-3">
          <input type="hidden" name="taskId" value={taskId} /><input type="hidden" name="projectId" value={id} />
          <textarea name="content" required rows={2} placeholder="Write a comment…" className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none focus:ring-2 focus:ring-pink-500/30" />
          <Button type="submit" size="sm">Post</Button>
        </form>
      </Panel>
    </div>
  );
}
