"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Search } from "lucide-react";
import { BuildStatusBadge, BUILD_STATUSES, BUILD_STATUS_LABEL, type BuildRow } from "./_shared";
import { BuildDeleteButton } from "./build-row-actions";
import { formatDate } from "@/lib/utils";

export function BuildsTable({ builds, isAdmin }: { builds: BuildRow[]; isAdmin: boolean }) {
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("");

  const filtered = builds.filter((b) => {
    const matchesQ = !q || `${b.title} ${b.client_name ?? ""} ${b.assignee_name ?? ""}`.toLowerCase().includes(q.toLowerCase());
    const matchesStatus = !status || b.status === status;
    return matchesQ && matchesStatus;
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search builds, clients, assignees…"
            className="h-9 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-pink-400"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-pink-400"
        >
          <option value="">All statuses</option>
          {BUILD_STATUSES.map((s) => <option key={s} value={s}>{BUILD_STATUS_LABEL[s]}</option>)}
        </select>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]">
        {filtered.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-slate-500">No builds match your filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/80">
                <tr>
                  {["Build", "Client", "Status", "Assignee", "Updated"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>
                  ))}
                  {isAdmin && <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((b) => (
                  <tr key={b.id} className="group transition-colors hover:bg-pink-50/30">
                    <td className="px-5 py-3.5">
                      <Link href={`/builds/${b.id}`} className="inline-flex items-center gap-1 font-semibold text-slate-950 transition-colors group-hover:text-pink-700">
                        {b.title}
                        <ArrowUpRight className="h-3.5 w-3.5 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-pink-600" />
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-slate-600">{b.client_name || "—"}</td>
                    <td className="px-5 py-3.5"><BuildStatusBadge status={b.status} /></td>
                    <td className="px-5 py-3.5 text-slate-600">{b.assignee_name || <span className="text-slate-400">Unassigned</span>}</td>
                    <td className="px-5 py-3.5 text-slate-400">{formatDate(b.updated_at)}</td>
                    {isAdmin && (
                      <td className="px-5 py-3.5">
                        <div className="flex justify-end"><BuildDeleteButton id={b.id} title={b.title} /></div>
                      </td>
                    )}
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
