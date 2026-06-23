"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { Activity, ListChecks, MessageSquare, Plus, ShieldAlert, Trash2, X } from "lucide-react";
import { api, extractApiError } from "@/lib/portal/api";
import { timeAgo } from "@/lib/portal/format";
import {
  PRIORITIES,
  PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  type Priority,
  type Task,
  type TaskActivity,
  type TaskBlocker,
  type TaskChecklistItem,
  type TaskComment,
  type TaskStatus,
  type User,
} from "@/lib/portal/types";
import { Button, IconButton } from "./button";
import { Input, Select, Textarea } from "./form";
import { useToast } from "./toast";
import { Avatar, EmptyState } from "./ui";

type Inner = "checklist" | "comments" | "blockers" | "activity";

function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

export function TaskPanel({
  taskId,
  users,
  onClose,
  onChange,
}: {
  taskId: number;
  users: User[];
  onClose: () => void;
  onChange: () => void;
}) {
  const toast = useToast();
  const [task, setTask] = React.useState<Task | null>(null);
  const [inner, setInner] = React.useState<Inner>("checklist");
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const load = React.useCallback(async () => {
    try {
      setTask(await api.get<Task>(`projects/tasks/${taskId}`));
    } catch (e) {
      toast(extractApiError((e as { body?: unknown }).body, "Failed to load task."), "danger");
    }
  }, [taskId, toast]);
  React.useEffect(() => { void load(); }, [load]);

  async function patch(body: Record<string, unknown>) {
    try {
      const updated = await api.patch<Task>(`projects/tasks/${taskId}`, body);
      setTask(updated);
      onChange();
    } catch (e) {
      toast(extractApiError((e as { body?: unknown }).body, "Update failed."), "danger");
    }
  }

  if (!mounted) return null;

  const theme = document.documentElement.getAttribute("data-theme") || "dark";

  return createPortal(
    <div className="portal-root" data-theme={theme}>
      <div className="fixed inset-0 z-[1054] bg-black/55" onClick={onClose} />
      <div className="portal-slide-panel portal-fade-in">
        {!task ? (
          <div className="p-5"><div className="portal-skeleton h-40" /></div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2 border-b p-4" style={{ borderColor: "var(--border)" }}>
              <Textarea
                defaultValue={task.name}
                rows={1}
                className="!border-0 !bg-transparent !p-0 text-[0.95rem] font-bold focus:!shadow-none"
                onBlur={(e) => e.target.value !== task.name && patch({ name: e.target.value })}
              />
              <button className="portal-icon-btn shrink-0" onClick={onClose}><X className="h-4 w-4" /></button>
            </div>

            <div className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-2">
                <label className="portal-label">Status
                  <Select value={task.status} onChange={(e) => patch({ status: e.target.value as TaskStatus })}>
                    {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
                  </Select>
                </label>
                <label className="portal-label">Priority
                  <Select value={task.priority} onChange={(e) => patch({ priority: e.target.value as Priority })}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                  </Select>
                </label>
                <label className="portal-label">Assignee
                  <Select value={task.assigned_to ?? ""} onChange={(e) => patch({ assigned_to: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">— Unassigned —</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
                  </Select>
                </label>
                <label className="portal-label">Due date
                  <Input type="date" defaultValue={task.due_date ?? ""} onBlur={(e) => patch({ due_date: e.target.value || null })} />
                </label>
              </div>

              <div>
                <div className="portal-label">Description</div>
                <Textarea defaultValue={task.description} rows={3} onBlur={(e) => e.target.value !== task.description && patch({ description: e.target.value })} />
              </div>

              <div className="portal-tabs">
                {(["checklist", "comments", "blockers", "activity"] as Inner[]).map((i) => (
                  <button key={i} className={`portal-tab ${inner === i ? "active" : ""}`} onClick={() => setInner(i)}>
                    {i === "checklist" && <ListChecks className="h-3.5 w-3.5" />}
                    {i === "comments" && <MessageSquare className="h-3.5 w-3.5" />}
                    {i === "blockers" && <ShieldAlert className="h-3.5 w-3.5" />}
                    {i === "activity" && <Activity className="h-3.5 w-3.5" />}
                    <span className="capitalize">{i}</span>
                  </button>
                ))}
              </div>

              {inner === "checklist" && <ChecklistInner taskId={taskId} items={task.checklist ?? []} reload={load} />}
              {inner === "comments" && <CommentsInner taskId={taskId} items={task.comments ?? []} reload={load} />}
              {inner === "blockers" && <BlockersInner taskId={taskId} items={task.blockers ?? []} reload={load} />}
              {inner === "activity" && <ActivityInner taskId={taskId} />}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function ChecklistInner({ taskId, items, reload }: { taskId: number; items: TaskChecklistItem[]; reload: () => void }) {
  const toast = useToast();
  const [title, setTitle] = React.useState("");
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try { await api.post("projects/task-checklist", { task: taskId, title }); setTitle(""); reload(); } catch (e) { toast(extractApiError((e as { body?: unknown }).body), "danger"); }
  }
  async function toggle(it: TaskChecklistItem) {
    try { await api.patch(`projects/task-checklist/${it.id}`, { completed: !it.completed }); reload(); } catch (e) { toast(extractApiError((e as { body?: unknown }).body), "danger"); }
  }
  async function remove(it: TaskChecklistItem) {
    try { await api.del(`projects/task-checklist/${it.id}`); reload(); } catch (e) { toast(extractApiError((e as { body?: unknown }).body), "danger"); }
  }
  return (
    <div>
      {items.length === 0 ? <EmptyState message="No checklist items." /> : (
        <div className="mb-2 flex flex-col">
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-2 py-1.5 text-[0.76rem]">
              <input type="checkbox" checked={it.completed} onChange={() => toggle(it)} />
              <span className={`flex-1 ${it.completed ? "line-through opacity-60" : ""}`}>{it.title}</span>
              <button onClick={() => remove(it)} className="portal-text-muted"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={add} className="flex gap-1.5">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add item…" className="portal-input" />
        <IconButton tone="primary" type="submit"><Plus className="h-3.5 w-3.5" /></IconButton>
      </form>
    </div>
  );
}

function CommentsInner({ taskId, items, reload }: { taskId: number; items: TaskComment[]; reload: () => void }) {
  const toast = useToast();
  const [content, setContent] = React.useState("");
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    try { await api.post("projects/task-comments", { task: taskId, content }); setContent(""); reload(); } catch (e) { toast(extractApiError((e as { body?: unknown }).body), "danger"); }
  }
  return (
    <div>
      {items.length === 0 ? <EmptyState message="No comments yet." /> : (
        <div className="mb-2 flex flex-col gap-3">
          {items.map((c) => (
            <div key={c.id} className="flex items-start gap-2">
              <Avatar name={c.author_name} size="sm" />
              <div className="min-w-0">
                <div className="text-[0.7rem]"><span className="font-semibold">{c.author_name || "User"}</span> <span className="portal-text-muted">{timeAgo(c.created_at)}</span></div>
                <div className="text-[0.76rem]">{c.content}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={add} className="flex flex-col gap-1.5">
        <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={2} placeholder="Write a comment…" />
        <Button size="sm" type="submit" className="self-end">Comment</Button>
      </form>
    </div>
  );
}

function BlockersInner({ taskId, items, reload }: { taskId: number; items: TaskBlocker[]; reload: () => void }) {
  const toast = useToast();
  const [desc, setDesc] = React.useState("");
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!desc.trim()) return;
    try { await api.post("projects/task-blockers", { task: taskId, description: desc }); setDesc(""); reload(); } catch (e) { toast(extractApiError((e as { body?: unknown }).body), "danger"); }
  }
  async function resolve(b: TaskBlocker) {
    try { await api.patch(`projects/task-blockers/${b.id}`, { resolved: true }); reload(); } catch (e) { toast(extractApiError((e as { body?: unknown }).body), "danger"); }
  }
  return (
    <div>
      {items.length === 0 ? <EmptyState message="No blockers." /> : (
        <div className="mb-2 flex flex-col gap-2">
          {items.map((b) => (
            <div key={b.id} className="rounded-md p-2 text-[0.74rem]" style={{ background: b.resolved ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)" }}>
              <div className="flex items-start justify-between gap-2">
                <span className={b.resolved ? "line-through opacity-60" : ""}>{b.description}</span>
                {!b.resolved && <button onClick={() => resolve(b)} className="shrink-0 text-[0.62rem]" style={{ color: "var(--accent-green)" }}>Resolve</button>}
              </div>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={add} className="flex flex-col gap-1.5">
        <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} placeholder="Describe the blocker…" />
        <Button size="sm" variant="danger" type="submit" className="self-end">Report</Button>
      </form>
    </div>
  );
}

function ActivityInner({ taskId }: { taskId: number }) {
  const [items, setItems] = React.useState<TaskActivity[]>([]);
  React.useEffect(() => {
    api.get<TaskActivity[] | { results: TaskActivity[] }>("projects/task-activity", { task: taskId }).then((d) => setItems(asList(d))).catch(() => {});
  }, [taskId]);
  if (items.length === 0) return <EmptyState message="No activity." />;
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((a) => (
        <div key={a.id} className="flex items-start gap-2 text-[0.73rem]">
          <Avatar name={a.user_name} size="xs" />
          <div><span className="font-medium">{a.user_name || "Someone"}</span> <span className="portal-text-muted">{a.action}</span><div className="portal-text-muted text-[0.62rem]">{timeAgo(a.created_at)}</div></div>
        </div>
      ))}
    </div>
  );
}
