"use client";
import * as React from "react";
import Link from "next/link";
import { List, Plus } from "lucide-react";
import { api } from "@/lib/portal/api";
import { BUILD_STATUSES, BUILD_STATUS_LABEL, type BuildRow, type BuildStatus } from "../_shared";

function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

const COL_DOT: Record<BuildStatus, string> = {
  DRAFT: "bg-slate-400",
  AI_DRAFTED: "bg-violet-500",
  ASSIGNED: "bg-cyan-500",
  IN_PROGRESS: "bg-amber-500",
  READY_FOR_REVIEW: "bg-indigo-500",
  CHANGES_REQUESTED: "bg-orange-500",
  DELIVERED: "bg-emerald-500",
};

export default function BuildsBoardPage() {
  const [builds, setBuilds] = React.useState<BuildRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [dragOver, setDragOver] = React.useState<BuildStatus | null>(null);

  const load = React.useCallback(async () => {
    try {
      setBuilds(asList(await api.get<BuildRow[] | { results: BuildRow[] }>("builds/my-builds")));
    } catch {
      setBuilds([]);
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    void load();
  }, [load]);

  async function move(id: number, from: BuildStatus, to: BuildStatus) {
    if (from === to) return;
    setBuilds((bs) => bs.map((b) => (b.id === id ? { ...b, status: to } : b)));
    try {
      await api.post(`builds/builds/${id}/status`, { status: to });
    } catch {
      load();
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Delivery flow</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Status board</h1>
          <p className="mt-1 text-sm text-slate-600">Drag builds between delivery stages.</p>
        </div>
        <Link href="/builds" className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-50">
          <List className="h-4 w-4 text-slate-500" /> List
        </Link>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-56 animate-pulse rounded-lg bg-slate-100" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {BUILD_STATUSES.map((status) => {
            const cards = builds.filter((b) => b.status === status);
            return (
              <div
                key={status}
                className={`flex flex-col rounded-lg border bg-slate-50/60 ${dragOver === status ? "border-cyan-400 ring-2 ring-cyan-200" : "border-slate-200"}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(status);
                }}
                onDragLeave={() => setDragOver((s) => (s === status ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(null);
                  const id = Number(e.dataTransfer.getData("id"));
                  const from = e.dataTransfer.getData("from") as BuildStatus;
                  if (id) move(id, from, status);
                }}
              >
                <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <span className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${COL_DOT[status]}`} />{BUILD_STATUS_LABEL[status]}</span>
                  <span className="text-slate-400">{cards.length}</span>
                </div>
                <div className="flex min-h-[60px] flex-col gap-2 p-2.5">
                  {cards.length === 0 ? (
                    <p className="py-3 text-center text-xs text-slate-400">—</p>
                  ) : (
                    cards.map((b) => (
                      <div
                        key={b.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("id", String(b.id));
                          e.dataTransfer.setData("from", status);
                        }}
                        className="cursor-grab rounded-md border border-slate-200 bg-white p-2.5 shadow-sm transition-colors hover:border-cyan-200"
                      >
                        <Link href={`/builds/${b.id}`} className="text-sm font-semibold text-slate-900 hover:text-cyan-700">{b.title}</Link>
                        <p className="mt-0.5 text-xs text-slate-500">{b.client_name || "—"}</p>
                        {b.assignee_name && <p className="mt-1 text-[11px] text-slate-400">{b.assignee_name}</p>}
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
