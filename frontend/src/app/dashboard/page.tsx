import Link from "next/link";
import {
  ArrowUpRight,
  ClipboardCheck,
  Clock,
  GitPullRequest,
  LayoutDashboard,
  PackageCheck,
  Plus,
  Rows3,
} from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { StatusBadge } from "@/components/status-badge";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STAT_STYLES = [
  { icon: "bg-cyan-50 text-cyan-700 ring-cyan-100", bar: "bg-cyan-500" },
  { icon: "bg-amber-50 text-amber-700 ring-amber-100", bar: "bg-amber-500" },
  { icon: "bg-indigo-50 text-indigo-700 ring-indigo-100", bar: "bg-indigo-500" },
  { icon: "bg-emerald-50 text-emerald-700 ring-emerald-100", bar: "bg-emerald-500" },
];

export default async function DashboardPage() {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";

  const builds = await prisma.build.findMany({
    where: isAdmin ? {} : { assigneeId: user.id },
    include: { client: true, assignee: true, _count: { select: { tasks: true, changeRequests: true } } },
    orderBy: { updatedAt: "desc" },
  });
  const pendingSelfSignups = isAdmin
    ? await prisma.user.count({ where: { active: false } })
    : 0;

  const totalTasks = builds.reduce((sum, b) => sum + b._count.tasks, 0);
  const activeBuilds = builds.filter((b) => b.status !== "DELIVERED");
  const pendingChanges = builds.reduce((sum, b) => sum + b._count.changeRequests, 0);
  const overdueBuilds = builds.filter((b) => b.dueDate && b.dueDate < new Date() && b.status !== "DELIVERED").length;
  const assignedWorkload = builds.reduce<Record<string, number>>((acc, build) => {
    if (build.assignee) acc[build.assignee.name] = (acc[build.assignee.name] ?? 0) + 1;
    return acc;
  }, {});
  const stats = [
    { label: "Active builds", value: activeBuilds.length, icon: Rows3 },
    { label: "In progress", value: builds.filter((b) => b.status === "IN_PROGRESS").length, icon: Clock },
    {
      label: "Awaiting review",
      value: builds.filter((b) => b.status === "READY_FOR_REVIEW").length,
      icon: ClipboardCheck,
    },
    { label: "Delivered", value: builds.filter((b) => b.status === "DELIVERED").length, icon: PackageCheck },
  ];
  const adminMetrics = [
    { label: "Overdue", value: overdueBuilds },
    { label: "Pending changes", value: pendingChanges },
    { label: "Pending approvals", value: builds.filter((b) => b.status === "READY_FOR_REVIEW").length },
    { label: "Signup requests", value: pendingSelfSignups },
  ];

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-lg border border-white/80 bg-white/85 shadow-sm shadow-slate-900/[0.04] backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-5 p-6 sm:p-7">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-md bg-cyan-50 px-2.5 py-1 text-xs font-semibold text-cyan-700 ring-1 ring-cyan-100">
              <LayoutDashboard className="h-3.5 w-3.5" />
              {isAdmin ? "Admin workspace" : "Member workspace"}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
              {isAdmin ? "Delivery dashboard" : "My delivery work"}
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {builds.length} build{builds.length !== 1 ? "s" : ""} and {totalTasks} task
              {totalTasks !== 1 ? "s" : ""} in scope.
            </p>
          </div>
          {isAdmin && (
            <Link
              href="/builds/new"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-cyan-700 px-4 text-sm font-semibold text-white shadow-sm shadow-cyan-900/10 transition-colors duration-200 hover:bg-cyan-800"
            >
              <Plus className="h-4 w-4" />
              New build
            </Link>
          )}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          const style = STAT_STYLES[i];
          return (
            <div
              key={stat.label}
              className="relative overflow-hidden rounded-lg border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/[0.03]"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-3xl font-semibold tracking-tight text-slate-950">{stat.value}</p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {stat.label}
                  </p>
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

      {isAdmin && (
        <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-lg border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/[0.03]">
            <div className="flex items-center gap-2">
              <GitPullRequest className="h-4 w-4 text-cyan-700" />
              <h2 className="text-sm font-semibold text-slate-950">Operational signals</h2>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {adminMetrics.map((metric) => (
                <div key={metric.label} className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xl font-semibold text-slate-950">{metric.value}</p>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{metric.label}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/[0.03]">
            <h2 className="text-sm font-semibold text-slate-950">Team workload</h2>
            <div className="mt-4 space-y-2">
              {Object.entries(assignedWorkload).length === 0 ? (
                <p className="text-sm text-slate-500">No assigned builds yet.</p>
              ) : (
                Object.entries(assignedWorkload).map(([name, count]) => (
                  <div key={name} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <span className="font-medium text-slate-700">{name}</span>
                    <span className="font-semibold text-slate-950">{count}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-950">Recent builds</h2>
            <p className="mt-0.5 text-xs text-slate-500">Latest delivery records by update time.</p>
          </div>
          <Link
            href="/builds"
            className="flex items-center gap-1 text-xs font-semibold text-cyan-700 transition-colors hover:text-cyan-900"
          >
            View all
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {builds.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100">
              <Rows3 className="h-5 w-5 text-slate-400" />
            </div>
            <p className="mt-3 text-sm font-semibold text-slate-950">No builds yet</p>
            <p className="mt-1 text-xs text-slate-500">
              {isAdmin ? "Create your first build to get started." : "You have not been assigned any builds."}
            </p>
            {isAdmin && (
              <Link
                href="/builds/new"
                className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-cyan-700 px-3 text-xs font-semibold text-white transition-colors hover:bg-cyan-800"
              >
                <Plus className="h-3.5 w-3.5" />
                New build
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/80">
                <tr>
                  {["Build", "Client", "Status", "Assignee", "Tasks", "Updated"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {builds.slice(0, 8).map((build) => (
                  <tr key={build.id} className="group transition-colors hover:bg-cyan-50/30">
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/builds/${build.id}`}
                        className="font-semibold text-slate-950 transition-colors group-hover:text-cyan-700"
                      >
                        {build.title}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-slate-600">{build.client.name}</td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={build.status} />
                    </td>
                    <td className="px-5 py-3.5">
                      {build.assignee ? (
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-[10px] font-semibold text-cyan-700 ring-1 ring-cyan-100">
                            {build.assignee.name
                              .split(" ")
                              .map((n) => n[0])
                              .slice(0, 2)
                              .join("")
                              .toUpperCase()}
                          </span>
                          <span className="text-slate-600">{build.assignee.name}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400">Unassigned</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 tabular-nums text-slate-600">{build._count.tasks}</td>
                    <td className="px-5 py-3.5 text-slate-400">{formatDate(build.updatedAt)}</td>
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
