import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import {
  PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  type Project,
} from "@/lib/portal/types";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  on_hold: "bg-amber-50 text-amber-700 ring-amber-200",
  completed: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  cancelled: "bg-red-50 text-red-700 ring-red-200",
};
const PRIORITY_STYLE: Record<string, string> = {
  low: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  medium: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  high: "bg-amber-50 text-amber-700 ring-amber-200",
  critical: "bg-red-50 text-red-700 ring-red-200",
};

function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

export default async function ProjectsPage() {
  await requireUser();
  const projects = await serverApi
    .get<Project[] | { results: Project[] }>("projects/my-projects")
    .then(asList)
    .catch(() => [] as Project[]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Delivery</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Projects</h1>
          <p className="mt-1 text-sm text-slate-600">
            Client projects tracked in the Calari portal backend.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]">
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100">
              <FolderKanban className="h-5 w-5 text-slate-400" />
            </div>
            <p className="mt-3 text-sm font-semibold text-slate-950">No projects yet</p>
            <p className="mt-1 text-xs text-slate-500">Projects created in the portal will appear here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/80">
                <tr>
                  {["Project", "Client", "Status", "Priority", "Progress", "Due"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {projects.map((p) => (
                  <tr key={p.id} className="group transition-colors hover:bg-cyan-50/30">
                    <td className="px-5 py-3.5">
                      <Link href={`/projects/${p.id}`} className="font-semibold text-slate-950 transition-colors group-hover:text-cyan-700">
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-slate-600">{p.client_name || "—"}</td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset ${STATUS_STYLE[p.status] ?? "bg-slate-50 text-slate-600 ring-slate-200"}`}>
                        {PROJECT_STATUS_LABELS[p.status] ?? p.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset ${PRIORITY_STYLE[p.priority] ?? "bg-slate-50 text-slate-600 ring-slate-200"}`}>
                        {PRIORITY_LABELS[p.priority] ?? p.priority}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-cyan-600" style={{ width: `${p.progress_percent ?? 0}%` }} />
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
    </div>
  );
}
