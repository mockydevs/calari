import Link from "next/link";
import { ArrowRight, ListChecks, Search } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import { TaskCard } from "../builds/task-card";
import { QuickTaskForm } from "./quick-task-form";
import { TASK_STATUSES, TASK_STATUS_LABEL, TASK_TYPES, TASK_TYPE_LABEL, type BuildTask, type DjangoClient, type DjangoUser } from "../builds/_shared";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";
type Query = { scope?: string; status?: string; search?: string; type?: string; kind?: string; page?: string; task?: string };
type Page<T> = { results: T[]; count: number; next: string | null; previous: string | null };
type Summary = { total: number; in_progress: number; blocked: number; done: number; overdue: number };
function asList<T>(data: T[] | Page<T>): T[] { return Array.isArray(data) ? data : data.results; }

export default async function TasksPage({ searchParams }: { searchParams: Promise<Query> }) {
  const user = await requireUser();
  const canManage = user.role === "ADMIN" || (user.features ?? []).includes("builds_manage");
  const query = await searchParams;
  const scope = canManage && query.scope !== "mine" ? "all" : "mine";
  const page = Math.max(1, Number.parseInt(query.page || "1", 10) || 1);
  const params = new URLSearchParams();
  if (scope === "mine") params.set("assignee", user.id);
  if (query.task) params.set("id", query.task);
  for (const key of ["status", "search", "type", "kind"] as const) if (query[key]) params.set(key, query[key]!);
  const [taskResult, summary, users, clients] = await Promise.all([
    serverApi.get<BuildTask[] | Page<BuildTask>>(`builds/tasks?${params}&page=${page}&ordering=-created_at`).catch(() => null),
    serverApi.get<Summary>(`builds/tasks/summary?${params}`).catch(() => null),
    canManage ? serverApi.get<DjangoUser[] | Page<DjangoUser>>("builds/tasks/assignees").then(asList).catch(() => []) : Promise.resolve([]),
    canManage ? serverApi.get<DjangoClient[] | Page<DjangoClient>>("projects/clients").then(asList).catch(() => []) : Promise.resolve([]),
  ]);
  const tasks = taskResult ? asList(taskResult) : [];
  function href(overrides: Partial<Query>) {
    const next = { ...query, scope, page: undefined, ...overrides };
    const p = new URLSearchParams();
    Object.entries(next).forEach(([key, value]) => { if (value) p.set(key, value); });
    return `/tasks?${p}`;
  }
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Workspace / Tasks</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">A clear view of the work.</h1><p className="mt-2 text-sm text-slate-500">Assignments, priorities, and progress across your team.</p></div>
        <Link href="/builds" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium">GHL meeting tasks <ArrowRight className="h-4 w-4" /></Link>
      </header>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {([['Matching tasks', 'total'], ['In progress', 'in_progress'], ['Blocked', 'blocked'], ['Overdue', 'overdue'], ['Completed', 'done']] as const).map(([label, key]) => <div key={key} className="rounded-xl border border-slate-200 bg-white p-5"><p className="text-xs font-medium text-slate-500">{label}</p><p className={`mt-3 text-3xl font-semibold tracking-tight ${key === 'overdue' && summary?.overdue ? 'text-red-600' : 'text-slate-900'}`}>{summary?.[key] ?? '—'}</p></div>)}
      </div>
      {canManage && <QuickTaskForm clients={clients} users={users} />}
      {user.role === "ADMIN" && <Link href="/settings/slack" className="inline-block text-sm font-medium text-pink-700 hover:underline">Slack responsibilities & activity</Link>}
      {query.task && <Link href="/tasks" className="inline-block text-sm text-slate-600 hover:underline">Viewing one task · Show all tasks</Link>}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <nav aria-label="Task scope" className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
            {canManage && <Link href={href({ scope: "all" })} aria-current={scope === "all" ? "page" : undefined} className={`rounded-md px-4 py-2 ${scope === 'all' ? 'bg-white font-semibold shadow-sm' : 'text-slate-500'}`}>All tasks</Link>}
            <Link href={href({ scope: "mine" })} aria-current={scope === "mine" ? "page" : undefined} className={`rounded-md px-4 py-2 ${scope === 'mine' ? 'bg-white font-semibold shadow-sm' : 'text-slate-500'}`}>My tasks</Link>
          </nav><span className="text-xs text-slate-500">{summary ? `${summary.total} tasks in this view` : 'Task workspace'}</span>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-slate-100 bg-slate-50/50 p-5">
          <input type="hidden" name="scope" value={scope} />
          <label className="min-w-48 flex-1 space-y-1.5 text-xs font-medium text-slate-500">Search tasks<div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4" /><Input name="search" defaultValue={query.search} placeholder="Search title or description…" className="pl-9" /></div></label>
          <label className="space-y-1.5 text-xs font-medium text-slate-500">Status<Select name="status" defaultValue={query.status || ''}><option value="">All statuses</option>{TASK_STATUSES.map(s => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}</Select></label>
          <label className="space-y-1.5 text-xs font-medium text-slate-500">Work type<Select name="kind" defaultValue={query.kind || ''}><option value="">All work</option><option value="general">Internal tasks</option><option value="ghl">GHL tasks</option></Select></label>
          <label className="space-y-1.5 text-xs font-medium text-slate-500">Category<Select name="type" defaultValue={query.type || ''}><option value="">All categories</option>{TASK_TYPES.map(t => <option key={t} value={t}>{TASK_TYPE_LABEL[t]}</option>)}</Select></label>
          <Button type="submit" variant="primary">Apply</Button><Link href={`/tasks?scope=${scope}`} className="px-2 py-2 text-xs text-slate-500 hover:underline">Reset</Link>
        </form>
        {!taskResult ? <div role="alert" className="p-10 text-center"><p className="font-medium text-red-700">Tasks could not be loaded.</p><p className="mt-2 text-sm text-slate-500">Your work has not been changed. Check the API connection and try again.</p><Link href={href({ page: String(page) })} className="mt-4 inline-block text-sm font-semibold text-pink-700">Try again</Link></div> : tasks.length === 0 ? <div className="px-6 py-16 text-center"><ListChecks className="mx-auto h-9 w-9 text-slate-300" /><h2 className="mt-4 font-semibold">{scope === 'mine' ? 'No tasks assigned to you in this view' : 'No tasks in this view yet'}</h2><p className="mt-2 text-sm text-slate-500">{canManage ? 'Create a task above, approve a GHL meeting task, or adjust your filters.' : 'Your assignments will appear here. Try clearing the filters.'}</p></div> : <ul className="divide-y divide-slate-100">{tasks.map(task => <TaskCard key={task.id} task={task} buildId={task.build ?? ''} canManage={canManage || task.assignee === Number(user.id)} canManageBuilds={canManage} users={users} showBuildLink />)}</ul>}
        {taskResult && !Array.isArray(taskResult) && <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4 text-sm"><span className="text-slate-500">Page {page}</span><div className="flex gap-4">{taskResult.previous && <Link href={href({ page: String(page - 1) })}>Previous</Link>}{taskResult.next && <Link href={href({ page: String(page + 1) })}>Next</Link>}</div></div>}
      </section>
    </div>
  );
}
