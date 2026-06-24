import Link from "next/link";
import {
  AlarmClock, AlertTriangle, CalendarClock, FolderKanban, Flag, ListChecks, ShieldAlert, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";

type DTask = { id: number; name: string; status: string; priority: string; due_date: string | null; project_id: number; project_name: string };
type DMilestone = { id: number; name: string; due_date: string; project_id: number; project_name: string };
type DBlocker = { id: number; description: string; project_id: number; project_name: string; reported_by: string | null; created_at: string };
type DActivity = { id: number; action: string; detail: string; project_name: string; project_id: number; user_name: string | null; created_at: string };

export type MyDashboard = {
  stats: { my_active_projects: number; my_open_tasks: number; my_overdue_tasks: number; my_high_priority_tasks: number };
  almost_due_tasks: DTask[];
  overdue_tasks: DTask[];
  high_priority_tasks: DTask[];
  my_tasks: DTask[];
  upcoming_milestones: DMilestone[];
  active_blockers: DBlocker[];
  recent_activity: DActivity[];
};

const STATUS_STYLE: Record<string, string> = {
  todo: "bg-slate-100 text-slate-600 ring-slate-200",
  in_progress: "bg-amber-50 text-amber-700 ring-amber-200",
  in_review: "bg-violet-50 text-violet-700 ring-violet-200",
  done: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

function StatCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: React.ComponentType<{ className?: string }>; tone: string }) {
  return (
    <div className="rounded-lg border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-900/[0.03]">
      <div className="flex items-center justify-between">
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg ring-1", tone)}><Icon className="h-4.5 w-4.5" /></span>
        <span className="text-2xl font-semibold tabular-nums text-slate-950">{value}</span>
      </div>
      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  );
}

function TaskRow({ t }: { t: DTask }) {
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3">
      <div className="min-w-0">
        <Link href={`/projects/${t.project_id}/tasks/${t.id}`} className="truncate text-sm font-semibold text-slate-900 hover:text-pink-700">{t.name}</Link>
        <p className="truncate text-xs text-slate-400">{t.project_name}{t.due_date ? ` · due ${t.due_date}` : ""}</p>
      </div>
      <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset", STATUS_STYLE[t.status] ?? "")}>{t.status.replace("_", " ")}</span>
    </li>
  );
}

function ListCard({ title, icon, empty, children }: { title: string; icon: React.ReactNode; empty: string; children: React.ReactNode[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5 text-sm font-semibold text-slate-950">{icon}{title}</div>
      {children.length === 0 ? <p className="px-5 py-8 text-center text-sm text-slate-400">{empty}</p> : <ul className="divide-y divide-slate-100">{children}</ul>}
    </div>
  );
}

export function MemberDashboard({ data, name }: { data: MyDashboard; name: string }) {
  const { stats } = data;
  const firstName = name.split(" ")[0] || name;
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">My workspace</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Welcome back, {firstName}</h1>
        <p className="mt-1 text-sm text-slate-600">Your assigned work across active projects.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="My projects" value={stats.my_active_projects} icon={FolderKanban} tone="bg-pink-50 text-pink-700 ring-pink-100" />
        <StatCard label="Open tasks" value={stats.my_open_tasks} icon={ListChecks} tone="bg-indigo-50 text-indigo-700 ring-indigo-100" />
        <StatCard label="Overdue" value={stats.my_overdue_tasks} icon={AlertTriangle} tone="bg-red-50 text-red-700 ring-red-100" />
        <StatCard label="High priority" value={stats.my_high_priority_tasks} icon={Zap} tone="bg-amber-50 text-amber-700 ring-amber-100" />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <ListCard title="Overdue" icon={<AlertTriangle className="h-4 w-4 text-red-600" />} empty="Nothing overdue — nice.">
          {data.overdue_tasks.map((t) => <TaskRow key={t.id} t={t} />)}
        </ListCard>
        <ListCard title="Due soon" icon={<AlarmClock className="h-4 w-4 text-amber-600" />} empty="No tasks due in the next 7 days.">
          {data.almost_due_tasks.map((t) => <TaskRow key={t.id} t={t} />)}
        </ListCard>
        <ListCard title="High priority" icon={<Zap className="h-4 w-4 text-amber-600" />} empty="No high-priority tasks.">
          {data.high_priority_tasks.map((t) => <TaskRow key={t.id} t={t} />)}
        </ListCard>
        <ListCard title="My tasks" icon={<ListChecks className="h-4 w-4 text-pink-700" />} empty="No open tasks assigned to you.">
          {data.my_tasks.map((t) => <TaskRow key={t.id} t={t} />)}
        </ListCard>
        <ListCard title="Upcoming milestones" icon={<Flag className="h-4 w-4 text-pink-700" />} empty="No upcoming milestones.">
          {data.upcoming_milestones.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <Link href={`/projects/${m.project_id}`} className="truncate font-medium text-slate-800 hover:text-pink-700">{m.name}</Link>
              <span className="shrink-0 text-xs text-slate-400">{m.due_date}</span>
            </li>
          ))}
        </ListCard>
        <ListCard title="Active blockers" icon={<ShieldAlert className="h-4 w-4 text-red-600" />} empty="No active blockers.">
          {data.active_blockers.map((b) => (
            <li key={b.id} className="px-5 py-3 text-sm">
              <Link href={`/projects/${b.project_id}`} className="font-medium text-red-700 hover:underline">{b.project_name}</Link>
              <p className="text-xs text-slate-600">{b.description}</p>
            </li>
          ))}
        </ListCard>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5 text-sm font-semibold text-slate-950"><CalendarClock className="h-4 w-4 text-slate-500" /> Recent activity</div>
        {data.recent_activity.length === 0 ? <p className="px-5 py-8 text-center text-sm text-slate-400">No recent activity.</p> : (
          <ul className="divide-y divide-slate-100">
            {data.recent_activity.map((a) => (
              <li key={a.id} className="px-5 py-3 text-sm text-slate-600">
                <span className="font-medium text-slate-800">{a.user_name || "Someone"}</span> {a.action} · <Link href={`/projects/${a.project_id}`} className="text-pink-700 hover:underline">{a.project_name}</Link>
                <span className="ml-1 text-xs text-slate-400">{formatDate(a.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
