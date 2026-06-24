import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Clock, FolderKanban, LayoutDashboard, PauseCircle, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import { PRIORITY_LABELS, PROJECT_STATUS_LABELS, type Project } from "@/lib/portal/types";
import { cn } from "@/lib/utils";
import { AdminDashboard, type AdminStats } from "./admin-view";
import { MemberDashboard, type MyDashboard } from "./member-view";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  on_hold: "bg-amber-50 text-amber-700 ring-amber-200",
  completed: "bg-pink-50 text-pink-700 ring-pink-200",
  cancelled: "bg-red-50 text-red-700 ring-red-200",
};
const STAT_STYLES = [
  { icon: "bg-pink-50 text-pink-700 ring-pink-100", bar: "bg-pink-500" },
  { icon: "bg-emerald-50 text-emerald-700 ring-emerald-100", bar: "bg-emerald-500" },
  { icon: "bg-amber-50 text-amber-700 ring-amber-100", bar: "bg-amber-500" },
  { icon: "bg-indigo-50 text-indigo-700 ring-indigo-100", bar: "bg-indigo-500" },
];

function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

export default async function DashboardPage() {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";

  // Admins get the full operational overview.
  if (isAdmin) {
    const stats = await serverApi.get<AdminStats>("projects/admin-dashboard").catch(() => null);
    if (stats) return <AdminDashboard stats={stats} />;
  } else {
    // Members get a personalized "my work" dashboard.
    const myDash = await serverApi.get<MyDashboard>("projects/my-dashboard").catch(() => null);
    if (myDash) return <MemberDashboard data={myDash} name={user.name} />;
  }

  const projects = await serverApi
    .get<Project[] | { results: Project[] }>("projects/my-projects")
    .then(asList)
    .catch(() => [] as Project[]);

  const active = projects.filter((p) => p.status === "active");
  const completed = projects.filter((p) => p.status === "completed");
  const onHold = projects.filter((p) => p.status === "on_hold");
  const stats = [
    { label: "Active projects", value: active.length, icon: FolderKanban },
    { label: "Completed", value: completed.length, icon: CheckCircle2 },
    { label: "On hold", value: onHold.length, icon: PauseCircle },
    { label: "Total", value: projects.length, icon: Clock },
  ];

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-lg border border-white/80 bg-white/85 shadow-sm shadow-slate-900/[0.04] backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-5 p-6 sm:p-7">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-md bg-pink-50 px-2.5 py-1 text-xs font-semibold text-pink-700 ring-1 ring-pink-100">
              <LayoutDashboard className="h-3.5 w-3.5" />
              {isAdmin ? "Admin workspace" : "Member workspace"}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
              Delivery dashboard
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {projects.length} project{projects.length !== 1 ? "s" : ""} in scope.
            </p>
          </div>
          <Link
            href="/projects"
            className="inline-flex h-10 items-center gap-2 rounded-md bg-pink-700 px-4 text-sm font-semibold text-white shadow-sm shadow-pink-900/10 transition-colors hover:bg-pink-800"
          >
            <Plus className="h-4 w-4" />
            View projects
          </Link>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          const style = STAT_STYLES[i];
          return (
            <div key={stat.label} className="relative overflow-hidden rounded-lg border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/[0.03]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-3xl font-semibold tracking-tight text-slate-950">{stat.value}</p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{stat.label}</p>
                </div>
                <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1", style.icon)}>
                  <Icon className="h-5 w-5" />
                </span>
              </div>
              <div className={cn("absolute inset-x-0 bottom-0 h-0.5", style.bar)} />
            </div>
          );
        })}
      </div>

      <section className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-950">Recent projects</h2>
            <p className="mt-0.5 text-xs text-slate-500">Your latest delivery work.</p>
          </div>
          <Link href="/projects" className="flex items-center gap-1 text-xs font-semibold text-pink-700 transition-colors hover:text-pink-900">
            View all
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100">
              <FolderKanban className="h-5 w-5 text-slate-400" />
            </div>
            <p className="mt-3 text-sm font-semibold text-slate-950">No projects yet</p>
            <p className="mt-1 text-xs text-slate-500">Projects created in the portal appear here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/80">
                <tr>
                  {["Project", "Client", "Status", "Priority", "Progress"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {projects.slice(0, 8).map((p) => (
                  <tr key={p.id} className="group transition-colors hover:bg-pink-50/30">
                    <td className="px-5 py-3.5">
                      <Link href={`/projects/${p.id}`} className="font-semibold text-slate-950 transition-colors group-hover:text-pink-700">
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-slate-600">{p.client_name || "—"}</td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset ${STATUS_STYLE[p.status] ?? "bg-slate-50 text-slate-600 ring-slate-200"}`}>
                        {PROJECT_STATUS_LABELS[p.status] ?? p.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 capitalize text-slate-600">{PRIORITY_LABELS[p.priority] ?? p.priority}</td>
                    <td className="px-5 py-3.5 tabular-nums text-slate-500">{p.progress_percent ?? 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
