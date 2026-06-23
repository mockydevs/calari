"use client";
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/portal/api";
import {
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  type TaskBoard,
  type TaskCard,
  type TaskStatus,
} from "@/lib/portal/types";

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
  const [board, setBoard] = React.useState<TaskBoard | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [dragOver, setDragOver] = React.useState<TaskStatus | null>(null);

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
  }, [load]);

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
      </div>

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
                        className={`cursor-grab rounded-md border border-l-[3px] border-slate-200 bg-white p-2.5 shadow-sm ${PRIORITY_BORDER[t.priority] ?? "border-l-slate-300"}`}
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
