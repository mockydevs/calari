"use client";
import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus, X } from "lucide-react";
import { api } from "@/lib/portal/api";
import { useToast } from "@/components/toast";
import {
  PRIORITIES,
  PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  type TaskBoard,
  type TaskCard,
  type TaskStatus,
} from "@/lib/portal/types";

type UserOpt = { id: number; full_name?: string; username?: string };
const fieldCls = "h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:border-pink-500 focus:outline-none focus:ring-2 focus:ring-pink-500/30";

const COLUMN_DOT: Record<TaskStatus, string> = {
  todo: "bg-slate-400",
  in_progress: "bg-amber-500",
  in_review: "bg-violet-500",
  done: "bg-emerald-500",
};
const PRIORITY_BORDER: Record<string, string> = {
  critical: "border-l-red-500",
  high: "border-l-amber-500",
  medium: "border-l-pink-500",
  low: "border-l-emerald-500",
};

export default function ProjectBoardPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const [board, setBoard] = React.useState<TaskBoard | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [dragOver, setDragOver] = React.useState<TaskStatus | null>(null);
  const [users, setUsers] = React.useState<UserOpt[]>([]);
  const [creating, setCreating] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setBoard(await api.get<TaskBoard>(`projects/tasks/board/${id}`));
    } catch {
      setBoard({ todo: [], in_progress: [], in_review: [], done: [] });
    } finally {
      setLoading(false);
    }
  }, [id]);

  React.useEffect(() => {
    void load();
    // Assignee options (admins only; members get an empty list — that's fine).
    api.get<UserOpt[] | { results: UserOpt[] }>("auth/users")
      .then((r) => setUsers(Array.isArray(r) ? r : r.results ?? []))
      .catch(() => setUsers([]));
  }, [load]);

  async function createTask(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    if (!name) return;
    setSubmitting(true);
    try {
      await api.post("projects/tasks", {
        project: Number(id),
        name,
        status: String(fd.get("status") || "todo"),
        priority: String(fd.get("priority") || "medium"),
        assigned_to: fd.get("assigned_to") ? Number(fd.get("assigned_to")) : null,
        due_date: String(fd.get("due_date") || "") || null,
      });
      setCreating(false);
      await load();
      toast.success("Task created.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create task.");
    } finally {
      setSubmitting(false);
    }
  }

  async function move(taskId: number, from: TaskStatus, to: TaskStatus) {
    if (from === to || !board) return;
    setBoard((b) => {
      if (!b) return b;
      const card = b[from].find((t) => t.id === taskId);
      if (!card) return b;
      return { ...b, [from]: b[from].filter((t) => t.id !== taskId), [to]: [{ ...card, status: to }, ...b[to]] };
    });
    try {
      await api.patch(`projects/tasks/${taskId}`, { status: to });
    } catch {
      load();
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href={`/projects/${id}`} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="text-xl font-semibold tracking-tight text-slate-950">{board?.project_name || "Task board"}</h1>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="ml-auto inline-flex h-9 items-center gap-2 rounded-md bg-gradient-to-r from-pink-600 to-fuchsia-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:from-pink-700 hover:to-fuchsia-700"
        >
          <Plus className="h-4 w-4" /> Add task
        </button>
      </div>

      {creating && (
        <div
          className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm sm:items-center"
          onClick={(e) => e.target === e.currentTarget && setCreating(false)}
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-950">New task</h2>
              <button onClick={() => setCreating(false)} aria-label="Close" className="rounded-md p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={createTask} className="space-y-4 p-5">
              <div className="space-y-1.5">
                <label htmlFor="t-name" className="text-sm font-medium text-slate-700">Task name</label>
                <input id="t-name" name="name" required autoFocus placeholder="e.g. Build GHL workflow" className={fieldCls} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="t-status" className="text-sm font-medium text-slate-700">Status</label>
                  <select id="t-status" name="status" defaultValue="todo" className={fieldCls}>
                    {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="t-priority" className="text-sm font-medium text-slate-700">Priority</label>
                  <select id="t-priority" name="priority" defaultValue="medium" className={fieldCls}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="t-assignee" className="text-sm font-medium text-slate-700">Assignee</label>
                  <select id="t-assignee" name="assigned_to" defaultValue="" className={fieldCls}>
                    <option value="">— Unassigned —</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="t-due" className="text-sm font-medium text-slate-700">Due date</label>
                  <input id="t-due" name="due_date" type="date" className={fieldCls} />
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button type="button" onClick={() => setCreating(false)} className="h-9 rounded-md px-4 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
                <button type="submit" disabled={submitting} className="inline-flex h-9 items-center gap-2 rounded-md bg-gradient-to-r from-pink-600 to-fuchsia-600 px-4 text-sm font-semibold text-white hover:from-pink-700 hover:to-fuchsia-700 disabled:opacity-50">
                  {submitting ? "Creating…" : "Create task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
          {TASK_STATUSES.map((status) => {
            const cards = board?.[status] ?? [];
            return (
              <div
                key={status}
                className={`flex flex-col rounded-lg border bg-slate-50/60 ${dragOver === status ? "border-pink-400 ring-2 ring-pink-200" : "border-slate-200"}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(status);
                }}
                onDragLeave={() => setDragOver((s) => (s === status ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(null);
                  const taskId = Number(e.dataTransfer.getData("taskId"));
                  const from = e.dataTransfer.getData("from") as TaskStatus;
                  if (taskId) move(taskId, from, status);
                }}
              >
                <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <span className={`h-2 w-2 rounded-full ${COLUMN_DOT[status]}`} />
                  {TASK_STATUS_LABELS[status]}
                  <span className="ml-auto text-slate-400">{cards.length}</span>
                </div>
                <div className="flex min-h-[60px] flex-col gap-2 p-2.5">
                  {cards.length === 0 ? (
                    <p className="py-4 text-center text-xs text-slate-400">No tasks</p>
                  ) : (
                    cards.map((t: TaskCard) => (
                      <div
                        key={t.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("taskId", String(t.id));
                          e.dataTransfer.setData("from", status);
                        }}
                        onClick={() => router.push(`/projects/${id}/tasks/${t.id}`)}
                        className={`cursor-pointer rounded-md border border-l-[3px] border-slate-200 bg-white p-2.5 shadow-sm transition-shadow hover:shadow-md ${PRIORITY_BORDER[t.priority] ?? "border-l-slate-300"}`}
                      >
                        <p className="text-sm font-medium text-slate-800">{t.name}</p>
                        <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                          <span className="capitalize">{t.priority}</span>
                          {t.assigned_to_name && <span>{t.assigned_to_name}</span>}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
