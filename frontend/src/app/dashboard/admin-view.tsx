import Link from "next/link";
import {
  AlertTriangle, Building2, CheckCircle2, FolderKanban, ListChecks, PauseCircle,
  Plus, ShieldAlert, Users, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type AdminStats = {
  projects: { total: number; active: number; completed: number; on_hold: number; cancelled: number; overdue: number };
  clients: { total: number; active: number };
  tasks: { total: number; done: number; pending: number; overdue: number };
  users: { total: number; active: number; inactive: number; superusers: number; admins: number };
  blockers: { project_open: number; task_open: number };
  staff_workload: { id: number; name: string; role: string; tasks: number; projects: number }[];
  recent_projects: { id: number; name: string; status: string; client_name: string | null; assigned_to_name: string | null; end_date: string }[];
  recent_tasks: { id: number; name: string; status: string; due_date: string | null; project_id: number; project_name: string | null; assigned_to_name: string | null }[];
  recent_clients: { id: number; name: string; email: string; company_name: string; is_active: boolean }[];
};

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  on_hold: "bg-amber-50 text-amber-700 ring-amber-200",
  completed: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  cancelled: "bg-red-50 text-red-700 ring-red-200",
  done: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  todo: "bg-slate-100 text-slate-600 ring-slate-200",
  in_progress: "bg-amber-50 text-amber-700 ring-amber-200",
  in_review: "bg-indigo-50 text-indigo-700 ring-indigo-200",
};

function StatCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: React.ComponentType<{ className?: string }>; tone: string }) {
  return (
    <div className="rounded-lg border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-900/[0.03]">
      <div className="flex items-center justify-between">
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg ring-1", tone)}>
          <Icon className="h-4.5 w-4.5" />
        </span>
        <span className="text-2xl font-semibold tabular-nums text-slate-950">{value}</span>
      </div>
      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  );
}

function Pill({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset", STATUS_STYLE[status] ?? "bg-slate-50 text-slate-600 ring-slate-200")}>
      {status.replace("_", " ")}
    </span>
  );
}

const QUICK_ACTIONS = [
  { label: "Add client", href: "/clients", icon: Building2 },
  { label: "Add project", href: "/projects", icon: FolderKanban },
  { label: "New build", href: "/builds/new", icon: Plus },
  { label: "All projects", href: "/projects", icon: ListChecks },
  { label: "All clients", href: "/clients", icon: Users },
  { label: "Team", href: "/settings/team", icon: Users },
];

export function AdminDashboard({ stats }: { stats: AdminStats }) {
  const { projects, clients, tasks, users, blockers } = stats;
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Admin workspace</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Admin dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">Operational overview — projects, clients, tasks, and team workload.</p>
      </div>

      {/* Project stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total projects" value={projects.total} icon={FolderKanban} tone="bg-cyan-50 text-cyan-700 ring-cyan-100" />
        <StatCard label="Active" value={projects.active} icon={CheckCircle2} tone="bg-emerald-50 text-emerald-700 ring-emerald-100" />
        <StatCard label="Completed" value={projects.completed} icon={CheckCircle2} tone="bg-indigo-50 text-indigo-700 ring-indigo-100" />
        <StatCard label="On hold" value={projects.on_hold} icon={PauseCircle} tone="bg-amber-50 text-amber-700 ring-amber-100" />
        <StatCard label="Overdue" value={projects.overdue} icon={AlertTriangle} tone="bg-red-50 text-red-700 ring-red-100" />
        <StatCard label="Cancelled" value={projects.cancelled} icon={XCircle} tone="bg-slate-100 text-slate-500 ring-slate-200" />
      </div>

      {/* Clients + tasks + blockers */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total clients" value={clients.total} icon={Building2} tone="bg-indigo-50 text-indigo-700 ring-indigo-100" />
        <StatCard label="Active clients" value={clients.active} icon={Building2} tone="bg-emerald-50 text-emerald-700 ring-emerald-100" />
        <StatCard label="Total tasks" value={tasks.total} icon={ListChecks} tone="bg-cyan-50 text-cyan-700 ring-cyan-100" />
        <StatCard label="Pending tasks" value={tasks.pending} icon={ListChecks} tone="bg-amber-50 text-amber-700 ring-amber-100" />
        <StatCard label="Project blockers" value={blockers.project_open} icon={ShieldAlert} tone="bg-red-50 text-red-700 ring-red-100" />
        <StatCard label="Task blockers" value={blockers.task_open} icon={ShieldAlert} tone="bg-red-50 text-red-700 ring-red-100" />
      </div>

      {/* User stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Total users" value={users.total} icon={Users} tone="bg-slate-100 text-slate-600 ring-slate-200" />
        <StatCard label="Active" value={users.active} icon={Users} tone="bg-emerald-50 text-emerald-700 ring-emerald-100" />
        <StatCard label="Inactive" value={users.inactive} icon={Users} tone="bg-slate-100 text-slate-500 ring-slate-200" />
        <StatCard label="Superusers" value={users.superusers} icon={ShieldAlert} tone="bg-indigo-50 text-indigo-700 ring-indigo-100" />
        <StatCard label="Admins" value={users.admins} icon={ShieldAlert} tone="bg-cyan-50 text-cyan-700 ring-cyan-100" />
      </div>

      {/* Quick actions */}
      <div className="rounded-lg border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/[0.03]">
        <h2 className="mb-3 text-sm font-semibold text-slate-950">Quick actions</h2>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {QUICK_ACTIONS.map((a) => {
            const Icon = a.icon;
            return (
              <Link key={a.label} href={a.href} className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-4 text-center text-sm font-medium text-slate-700 transition-colors hover:border-cyan-300 hover:bg-cyan-50/50 hover:text-cyan-800">
                <Icon className="h-5 w-5 text-cyan-700" />
                {a.label}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Recent projects + tasks */}
        <div className="space-y-4 lg:col-span-2">
          <div className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <h2 className="text-sm font-semibold text-slate-950">Recent projects</h2>
              <Link href="/projects" className="text-xs font-semibold text-cyan-700 hover:text-cyan-900">View all</Link>
            </div>
            <Rows
              empty="No projects yet."
              rows={stats.recent_projects.map((p) => ({
                key: p.id,
                href: `/projects/${p.id}`,
                main: p.name,
                sub: p.client_name || "—",
                right: <Pill status={p.status} />,
                meta: p.assigned_to_name || "Unassigned",
              }))}
            />
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <h2 className="text-sm font-semibold text-slate-950">Recent tasks</h2>
            </div>
            <Rows
              empty="No tasks yet."
              rows={stats.recent_tasks.map((t) => ({
                key: t.id,
                href: `/projects/${t.project_id}`,
                main: t.name,
                sub: t.project_name || "—",
                right: <Pill status={t.status} />,
                meta: t.assigned_to_name || "Unassigned",
              }))}
            />
          </div>
        </div>

        {/* Staff workload */}
        <div className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-3.5">
            <h2 className="text-sm font-semibold text-slate-950">Staff workload</h2>
            <p className="mt-0.5 text-xs text-slate-500">Active staff by open tasks &amp; projects</p>
          </div>
          {stats.staff_workload.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-400">No staff.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {stats.staff_workload.map((s) => (
                <li key={s.id} className="flex items-center justify-between px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{s.name}</p>
                    <p className="text-xs capitalize text-slate-400">{s.role}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4 text-sm tabular-nums">
                    <span className="flex flex-col items-center"><span className="font-semibold text-cyan-700">{s.tasks}</span><span className="text-[10px] uppercase text-slate-400">tasks</span></span>
                    <span className="flex flex-col items-center"><span className="font-semibold text-indigo-700">{s.projects}</span><span className="text-[10px] uppercase text-slate-400">proj</span></span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Recent clients */}
      <div className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-950">Recent clients</h2>
          <Link href="/clients" className="text-xs font-semibold text-cyan-700 hover:text-cyan-900">View all</Link>
        </div>
        {stats.recent_clients.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-400">No clients yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {stats.recent_clients.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <div>
                  <span className="font-medium text-slate-800">{c.name}</span>
                  <span className="block text-xs text-slate-400">{c.email}{c.company_name ? ` · ${c.company_name}` : ""}</span>
                </div>
                <Pill status={c.is_active ? "active" : "cancelled"} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Rows({ rows, empty }: { rows: { key: number; href: string; main: string; sub: string; right: React.ReactNode; meta: string }[]; empty: string }) {
  if (rows.length === 0) return <p className="px-5 py-8 text-center text-sm text-slate-400">{empty}</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center justify-between gap-3 px-5 py-3">
          <div className="min-w-0">
            <Link href={r.href} className="truncate text-sm font-semibold text-slate-900 hover:text-cyan-700">{r.main}</Link>
            <p className="truncate text-xs text-slate-400">{r.sub} · {r.meta}</p>
          </div>
          {r.right}
        </li>
      ))}
    </ul>
  );
}
