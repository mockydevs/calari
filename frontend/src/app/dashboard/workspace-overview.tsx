import Link from "next/link";
import { ArrowRight, ArrowUpRight, FolderKanban, ListChecks } from "lucide-react";
import { serverApi } from "@/lib/portal/server";
import type { AppUser } from "@/lib/auth-helpers";
import { BUILD_STATUS_LABEL, TASK_STATUS_LABEL, type BuildRow, type BuildTask } from "../builds/_shared";

type Summary = { total: number; done: number; overdue: number; blocked: number };
const asList = <T,>(data: T[] | { results: T[] }): T[] => Array.isArray(data) ? data : data.results;

export async function WorkspaceOverview({ user }: { user: AppUser }) {
  const manager = user.role === "ADMIN" || user.features.includes("builds_manage");
  const scope = manager ? '' : `assignee=${user.id}`;
  const [summary, tasks, builds] = await Promise.all([
    serverApi.get<Summary>(`builds/tasks/summary?${scope}`).catch(() => null),
    serverApi.get<BuildTask[] | { results: BuildTask[] }>(`builds/tasks?${scope}&ordering=-created_at&page_size=6`).then(asList).catch(() => null),
    serverApi.get<BuildRow[] | { results: BuildRow[] }>('builds/my-builds').then(asList).catch(() => null),
  ]);
  return <div className="space-y-7">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Workspace overview</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Welcome back, {user.name.split(' ')[0]}.</h1><p className="mt-2 text-sm text-slate-500">{manager ? 'Your team’s work, with the next steps in view.' : 'Your assignments and client delivery, in one place.'}</p></div><Link href="/dashboard?view=reports" className="flex items-center gap-2 text-xs font-medium text-slate-500">Project reports <ArrowUpRight className="h-4 w-4" /></Link></header>
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{[
      { label: 'Open assignments', value: summary ? summary.total - summary.done : '—', tone: 'text-slate-900' },
      { label: 'Overdue', value: summary?.overdue ?? '—', tone: summary?.overdue ? 'text-red-600' : 'text-slate-900' },
      { label: 'Blocked', value: summary?.blocked ?? '—', tone: summary?.blocked ? 'text-amber-600' : 'text-slate-900' },
      { label: 'Completed', value: summary?.done ?? '—', tone: 'text-emerald-700' },
    ].map(stat => <div key={stat.label} className="rounded-xl border border-slate-200 bg-white p-5"><p className="text-xs font-medium text-slate-500">{stat.label}</p><p className={`mt-3 text-3xl font-semibold tracking-tight ${stat.tone}`}>{stat.value}</p></div>)}</div>
    <div className="grid gap-4 md:grid-cols-3">{[
      { icon: ListChecks, title: manager ? 'Assign the next task' : 'Open my tasks', description: 'Internal work and client assignments.', href: '/tasks' },
      { title: 'GHL delivery', description: 'Meeting notes → reviewed tasks → staff.', href: '/builds' },
      { icon: FolderKanban, title: 'Project workspace', description: 'Milestones, files, and project delivery.', href: '/projects' },
    ].map(action => <Link key={action.href} href={action.href} className="group rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-pink-300"><div className="flex h-5 items-center justify-between">{action.icon && <action.icon className="h-5 w-5 text-pink-700" />}<ArrowUpRight className="ml-auto h-4 w-4 text-slate-300 group-hover:text-pink-700" /></div><h2 className="mt-4 text-sm font-semibold">{action.title}</h2><p className="mt-1 text-xs text-slate-500">{action.description}</p></Link>)}</div>
    <div className="grid items-start gap-5 xl:grid-cols-[1.4fr_1fr]">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="flex items-center justify-between border-b border-slate-100 p-5"><h2 className="font-semibold">Recent assignments</h2><Link href="/tasks" className="flex items-center gap-1 text-xs font-semibold text-pink-700">All tasks <ArrowRight className="h-3 w-3" /></Link></div>{!tasks ? <p role="alert" className="p-6 text-sm text-red-700">Could not load assignments. Try refreshing.</p> : !tasks.length ? <p className="p-10 text-center text-sm text-slate-500">No assignments yet. Tasks will appear here when created.</p> : <ul className="divide-y divide-slate-100">{tasks.slice(0, 6).map(task => <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div className="min-w-0 flex-1"><Link href={`/tasks?search=${encodeURIComponent(task.title)}`} className="text-sm font-medium hover:text-pink-700">{task.title}</Link><p className="mt-1 text-xs text-slate-500">{task.assignee_name || 'Unassigned'} · {task.build_title || 'Internal task'}</p></div><span className={`rounded-md px-2 py-1 text-[11px] font-medium ${task.status === 'DONE' ? 'bg-emerald-50 text-emerald-700' : task.status === 'BLOCKED' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{TASK_STATUS_LABEL[task.status]}</span></li>)}</ul>}</section>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="flex items-center justify-between border-b border-slate-100 p-5"><h2 className="font-semibold">GHL builds</h2><Link href="/builds" className="text-xs font-semibold text-pink-700">View all →</Link></div>{!builds ? <p role="alert" className="p-6 text-sm text-red-700">Could not load builds.</p> : !builds.length ? <p className="p-10 text-center text-sm text-slate-500">No client builds yet.</p> : <ul className="divide-y divide-slate-100">{builds.slice(0, 5).map(build => <li key={build.id} className="p-5"><p className="text-xs text-slate-500">{build.client_name}</p><Link href={`/builds/${build.id}#meeting-tasklist`} className="mt-1 block text-sm font-semibold hover:text-pink-700">{build.title}</Link><div className="mt-3 flex justify-between gap-2 text-xs"><span className="text-slate-500">{build.assignee_name || 'Unassigned'}</span><span className="font-medium text-pink-700">{BUILD_STATUS_LABEL[build.status]}</span></div></li>)}</ul>}</section>
    </div>
  </div>;
}
