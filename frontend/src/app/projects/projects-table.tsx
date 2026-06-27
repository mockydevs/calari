"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Search } from "lucide-react";
import { PRIORITY_LABELS, PROJECT_STATUS_LABELS, type Project } from "@/lib/portal/types";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  on_hold: "bg-amber-50 text-amber-700 ring-amber-200",
  completed: "bg-pink-50 text-pink-700 ring-pink-200",
  cancelled: "bg-red-50 text-red-700 ring-red-200",
};
const PRIORITY_STYLE: Record<string, string> = {
  low: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  medium: "bg-pink-50 text-pink-700 ring-pink-200",
  high: "bg-amber-50 text-amber-700 ring-amber-200",
  critical: "bg-red-50 text-red-700 ring-red-200",
};
const STATUSES = ["active", "on_hold", "completed", "cancelled"];
const PRIORITIES = ["low", "medium", "high", "critical"];

export function ProjectsTable({ projects }: { projects: Project[] }) {
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [priority, setPriority] = React.useState("");

  const filtered = projects.filter((p) => {
    const matchesQ = !q || `${p.name} ${p.client_name ?? ""}`.toLowerCase().includes(q.toLowerCase());
    return matchesQ && (!status || p.status === status) && (!priority || p.priority === priority);
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects, clients…"
            className="h-9 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-pink-400" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-pink-400">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABELS[s as keyof typeof PROJECT_STATUS_LABELS] ?? s}</option>)}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-pink-400">
          <option value="">All priorities</option>
          {PRIORITIES.map((s) => <option key={s} value={s}>{PRIORITY_LABELS[s as keyof typeof PRIORITY_LABELS] ?? s}</option>)}
        </select>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]">
        {filtered.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-slate-500">No projects match your filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/80">
                <tr>
                  {["Project", "Client", "Status", "Priority", "Progress", "Due"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => (
                  <tr key={p.id} className="group transition-colors hover:bg-pink-50/30">
                    <td className="px-5 py-3.5">
                      <Link href={`/projects/${p.id}`} className="inline-flex items-center gap-1 font-semibold text-slate-950 transition-colors group-hover:text-pink-700">
                        {p.name}
                        <ArrowUpRight className="h-3.5 w-3.5 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-pink-600" />
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-slate-600">{p.client_name || "—"}</td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset ${STATUS_STYLE[p.status] ?? "bg-slate-50 text-slate-600 ring-slate-200"}`}>{PROJECT_STATUS_LABELS[p.status] ?? p.status}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset ${PRIORITY_STYLE[p.priority] ?? "bg-slate-50 text-slate-600 ring-slate-200"}`}>{PRIORITY_LABELS[p.priority] ?? p.priority}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-pink-600" style={{ width: `${p.progress_percent ?? 0}%` }} />
                        </div>
                        <span className="tabular-nums text-xs text-slate-500">{p.progress_percent ?? 0}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-slate-400">{p.end_date || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
