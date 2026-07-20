import Link from "next/link";
import {
  AlarmClock, AlertTriangle, CalendarClock, FolderKanban, Flag, ListChecks, ShieldAlert, Zap, Briefcase, MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import { TASK_STATUS_LABEL, CHANGE_REQUEST_STATUS_LABEL } from "../builds/_shared";

type DTask = { id: number; name: string; status: string; priority: string; due_date: string | null; project_id: number; project_name: string };
type DBuild = { id: number; title: string; status: string; client_name: string; updated_at: string };
type DMilestone = { id: number; name: string; due_date: string; project_id: number; project_name: string };
type DBlocker = { id: number; description: string; project_id: number; project_name: string; reported_by: string | null; created_at: string };
type DActivity = { id: number; action: string; detail: string; project_name: string; project_id: number; user_name: string | null; created_at: string };
type DBuildTask = { id: number; title: string; status: string; due_date: string | null; build_id: number; build_title: string; client_name: string };
type DChangeRequest = { id: number; title: string; status: string; due_date: string | null; build_id: number; build_title: string; client_name: string };

export type MyDashboard = {
  stats: { my_active_projects: number; my_open_tasks: number; my_overdue_tasks: number; my_high_priority_tasks: number; my_open_builds?: number };
  my_builds?: DBuild[];
  my_build_tasks?: DBuildTask[];
  my_change_requests?: DChangeRequest[];
  almost_due_tasks: DTask[];
  overdue_tasks: DTask[];
  high_priority_tasks: DTask[];
  my_tasks: DTask[];
  upcoming_milestones: DMilestone[];
  active_blockers: DBlocker[];
  recent_activity: DActivity[];
};

const BUILD_STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600 ring-slate-200",
  AI_DRAFTED: "bg-violet-50 text-violet-700 ring-violet-200",
  ASSIGNED: "bg-pink-50 text-pink-700 ring-pink-200",
  IN_PROGRESS: "bg-amber-50 text-amber-700 ring-amber-200",
  READY_FOR_REVIEW: "bg-blue-50 text-blue-700 ring-blue-200",
  CHANGES_REQUESTED: "bg-orange-50 text-orange-700 ring-orange-200",
  DELIVERED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

const STATUS_STYLE: Record<string, string> = {
  todo: "bg-slate-100 text-slate-600 ring-slate-200",
  in_progress: "bg-amber-50 text-amber-700 ring-amber-200",
  in_review: "bg-violet-50 text-violet-700 ring-violet-200",
  done: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

// builds.Task / builds.ChangeRequest use upper-case status choices — a separate
// palette from the projects.Tasks lower-case one above.
const BUILD_ITEM_STATUS_STYLE: Record<string, string> = {
  TODO: "bg-slate-100 text-slate-600 ring-slate-200",
  IN_PROGRESS: "bg-amber-50 text-amber-700 ring-amber-200",
  BLOCKED: "bg-red-50 text-red-700 ring-red-200",
  DONE: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  PENDING: "bg-slate-100 text-slate-600 ring-slate-200",
  APPROVED: "bg-blue-50 text-blue-700 ring-blue-200",
  IN_BUILD: "bg-amber-50 text-amber-700 ring-amber-200",
  DEFERRED: "bg-slate-100 text-slate-500 ring-slate-200",
  REJECTED: "bg-red-50 text-red-700 ring-red-200",
  IMPLEMENTED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
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

function BuildTaskRow({ t }: { t: DBuildTask }) {
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3">
      <div className="min-w-0">
        <Link href={`/builds/${t.build_id}`} className="truncate text-sm font-semibold text-slate-900 hover:text-pink-700">{t.title}</Link>
        <p className="truncate text-xs text-slate-400">{t.client_name || t.build_title}{t.due_date ? ` · due ${t.due_date}` : ""}</p>
      </div>
      <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", BUILD_ITEM_STATUS_STYLE[t.status] ?? "")}>
        {TASK_STATUS_LABEL[t.status as keyof typeof TASK_STATUS_LABEL] ?? t.status}
      </span>
    </li>
  );
}

function ChangeRequestRow({ c }: { c: DChangeRequest }) {
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3">
      <div className="min-w-0">
        <Link href={`/builds/${c.build_id}`} className="truncate text-sm font-semibold text-slate-900 hover:text-pink-700">{c.title}</Link>
        <p className="truncate text-xs text-slate-400">{c.client_name || c.build_title}{c.due_date ? ` · due ${c.due_date}` : ""}</p>
      </div>
      <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", BUILD_ITEM_STATUS_STYLE[c.status] ?? "")}>
        {CHANGE_REQUEST_STATUS_LABEL[c.status as keyof typeof CHANGE_REQUEST_STATUS_LABEL] ?? c.status}
      </span>
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="My builds" value={stats.my_open_builds ?? 0} icon={Briefcase} tone="bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-100" />
        <StatCard label="My projects" value={stats.my_active_projects} icon={FolderKanban} tone="bg-pink-50 text-pink-700 ring-pink-100" />
        <StatCard label="Open tasks" value={stats.my_open_tasks} icon={ListChecks} tone="bg-indigo-50 text-indigo-700 ring-indigo-100" />
        <StatCard label="Overdue" value={stats.my_overdue_tasks} icon={AlertTriangle} tone="bg-red-50 text-red-700 ring-red-100" />
        <StatCard label="High priority" value={stats.my_high_priority_tasks} icon={Zap} tone="bg-amber-50 text-amber-700 ring-amber-100" />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <ListCard title="My builds" icon={<Briefcase className="h-4 w-4 text-fuchsia-700" />} empty="No builds assigned to you.">
          {(data.my_builds ?? []).map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <Link href={`/builds/${b.id}`} className="truncate text-sm font-semibold text-slate-900 hover:text-pink-700">{b.title}</Link>
                <p className="truncate text-xs text-slate-400">{b.client_name || "—"}</p>
              </div>
              <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset", BUILD_STATUS_STYLE[b.status] ?? "bg-slate-100 text-slate-600 ring-slate-200")}>{b.status.replace(/_/g, " ").toLowerCase()}</span>
            </li>
          ))}
        </ListCard>
        <ListCard title="Assigned to me" icon={<ListChecks className="h-4 w-4 text-pink-700" />} empty="No build tasks assigned to you.">
          {(data.my_build_tasks ?? []).map((t) => <BuildTaskRow key={t.id} t={t} />)}
        </ListCard>
        <ListCard title="Concerns raised for me" icon={<MessageSquare className="h-4 w-4 text-pink-700" />} empty="No client concerns assigned to you.">
          {(data.my_change_requests ?? []).map((c) => <ChangeRequestRow key={c.id} c={c} />)}
        </ListCard>
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
