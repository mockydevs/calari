"use client";
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, MessageSquare, Plus, Search, ListChecks } from "lucide-react";
import { api, extractApiError } from "@/lib/portal/api";
import { formatDate, isOverdue } from "@/lib/portal/format";
import {
  PRIORITIES,
  PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  type Priority,
  type TaskBoard,
  type TaskCard,
  type TaskStatus,
  type User,
} from "@/lib/portal/types";
import { Button, IconButton } from "@/components/portal/button";
import { Field, Input, Select, Textarea } from "@/components/portal/form";
import { Modal } from "@/components/portal/modal";
import { useToast } from "@/components/portal/toast";
import { Avatar, EmptyState, PriorityPill, Skeleton } from "@/components/portal/ui";
import { TaskPanel } from "@/components/portal/task-panel";

function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

const COLUMN_ACCENT: Record<TaskStatus, string> = {
  todo: "#64748b",
  in_progress: "var(--accent-amber)",
  in_review: "var(--accent-violet)",
  done: "var(--accent-green)",
};

export default function TaskBoardPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [board, setBoard] = React.useState<TaskBoard | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [users, setUsers] = React.useState<User[]>([]);
  const [search, setSearch] = React.useState("");
  const [assignee, setAssignee] = React.useState("");
  const [priority, setPriority] = React.useState("");
  const [dragOver, setDragOver] = React.useState<TaskStatus | null>(null);
  const [openTaskId, setOpenTaskId] = React.useState<number | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setBoard(await api.get<TaskBoard>(`projects/tasks/board/${id}`));
    } catch (e) {
      toast(extractApiError((e as { body?: unknown }).body, "Failed to load board."), "danger");
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  React.useEffect(() => {
    void load();
    api.get<User[] | { results: User[] }>("auth/users").then((u) => setUsers(asList(u))).catch(() => {});
  }, [load]);

  function matches(t: TaskCard) {
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (assignee && String(t.assigned_to) !== assignee) return false;
    if (priority && t.priority !== priority) return false;
    return true;
  }

  async function moveTask(taskId: number, from: TaskStatus, to: TaskStatus) {
    if (from === to || !board) return;
    // Optimistic update
    setBoard((b) => {
      if (!b) return b;
      const card = b[from].find((t) => t.id === taskId);
      if (!card) return b;
      return {
        ...b,
        [from]: b[from].filter((t) => t.id !== taskId),
        [to]: [{ ...card, status: to }, ...b[to]],
      };
    });
    try {
      await api.patch(`projects/tasks/${taskId}`, { status: to });
    } catch (e) {
      toast(extractApiError((e as { body?: unknown }).body, "Move failed."), "danger");
      load();
    }
  }

  return (
    <div className="portal-fade-in">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={`/staff/projects/${id}`} className="portal-icon-btn"><ArrowLeft className="h-4 w-4" /></Link>
          <h1 className="portal-page-title">{board?.project_name || "Task Board"}</h1>
        </div>
        <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Add Task</Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[160px] flex-1">
          <Search className="portal-text-muted pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
          <Input className="pl-8" placeholder="Search tasks…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-auto">
          <option value="">All Assignees</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
        </Select>
        <Select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-auto">
          <option value="">All Priorities</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
        </Select>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64" />)}</div>
      ) : (
        <div className="portal-kanban">
          {TASK_STATUSES.map((status) => {
            const cards = (board?.[status] ?? []).filter(matches);
            return (
              <div
                key={status}
                className={`portal-kanban-col ${dragOver === status ? "drag-over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(status); }}
                onDragLeave={() => setDragOver((s) => (s === status ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(null);
                  const taskId = Number(e.dataTransfer.getData("taskId"));
                  const from = e.dataTransfer.getData("from") as TaskStatus;
                  if (taskId) moveTask(taskId, from, status);
                }}
              >
                <div className="portal-kanban-col-head">
                  <span className="portal-status-dot" style={{ background: COLUMN_ACCENT[status] }} />
                  {TASK_STATUS_LABELS[status]}
                  <span className="portal-text-muted ml-auto">{cards.length}</span>
                </div>
                <div className="portal-kanban-list">
                  {cards.length === 0 ? (
                    <div className="portal-text-muted py-4 text-center text-[0.7rem]">No tasks</div>
                  ) : (
                    cards.map((t) => (
                      <div
                        key={t.id}
                        className="portal-task-card"
                        style={{ borderLeftColor: `var(--accent-${t.priority === "critical" ? "red" : t.priority === "high" ? "amber" : t.priority === "medium" ? "primary" : "green"})` }}
                        draggable
                        onDragStart={(e) => { e.dataTransfer.setData("taskId", String(t.id)); e.dataTransfer.setData("from", status); }}
                        onClick={() => setOpenTaskId(t.id)}
                      >
                        <div className="mb-1.5 flex items-start justify-between gap-2">
                          <span className="text-[0.78rem] font-medium leading-snug">{t.name}</span>
                          <PriorityPill priority={t.priority} />
                        </div>
                        {!!t.labels?.length && (
                          <div className="mb-1.5 flex flex-wrap gap-1">
                            {t.labels.map((l) => (
                              <span key={l.id} className="rounded px-1.5 py-0.5 text-[0.55rem] font-semibold" style={{ background: `${l.color}22`, color: l.color }}>{l.name}</span>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <div className="portal-text-muted flex items-center gap-2 text-[0.62rem]">
                            {!!t.comment_count && <span className="flex items-center gap-0.5"><MessageSquare className="h-3 w-3" />{t.comment_count}</span>}
                            {!!t.checklist_total && <span className="flex items-center gap-0.5"><ListChecks className="h-3 w-3" />{t.checklist_done}/{t.checklist_total}</span>}
                            {t.due_date && <span style={{ color: isOverdue(t.due_date) ? "var(--accent-red)" : undefined }}>{formatDate(t.due_date)}</span>}
                          </div>
                          {t.assigned_to_name && <Avatar name={t.assigned_to_name} size="xs" />}
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

      {openTaskId && (
        <TaskPanel taskId={openTaskId} users={users} onClose={() => setOpenTaskId(null)} onChange={load} />
      )}
      {createOpen && (
        <CreateTaskModal projectId={id} users={users} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); load(); toast("Task created.", "success"); }} />
      )}
    </div>
  );
}

function CreateTaskModal({ projectId, users, onClose, onCreated }: { projectId: string; users: User[]; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", description: "", status: "todo" as TaskStatus, priority: "medium" as Priority, assigned_to: "", due_date: "" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name) return toast("Task name is required.", "warning");
    setSaving(true);
    try {
      await api.post("projects/tasks", {
        project: Number(projectId),
        name: form.name,
        description: form.description,
        status: form.status,
        priority: form.priority,
        assigned_to: form.assigned_to ? Number(form.assigned_to) : null,
        due_date: form.due_date || null,
      });
      onCreated();
    } catch (e) { toast(extractApiError((e as { body?: unknown }).body, "Failed to create task."), "danger"); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title="New Task" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button form="nt-form" type="submit" loading={saving}>Create</Button></>}>
      <form id="nt-form" onSubmit={submit}>
        <Field label="Task name"><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus /></Field>
        <Field label="Description"><Textarea rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></Field>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label="Status"><Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as TaskStatus }))}>{TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}</Select></Field>
          <Field label="Priority"><Select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as Priority }))}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}</Select></Field>
          <Field label="Assignee"><Select value={form.assigned_to} onChange={(e) => setForm((f) => ({ ...f, assigned_to: e.target.value }))}><option value="">— Unassigned —</option>{users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}</Select></Field>
          <Field label="Due date"><Input type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} /></Field>
        </div>
      </form>
    </Modal>
  );
}
