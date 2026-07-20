import Link from "next/link";
import { ListChecks } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import { TaskCard } from "../builds/task-card";
import { QuickTaskForm } from "./quick-task-form";
import { TASK_STATUSES, TASK_STATUS_LABEL, type BuildTask, type DjangoClient, type DjangoUser } from "../builds/_shared";
import { Select } from "@/components/ui/select";

export const dynamic = "force-dynamic";

function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; status?: string }>;
}) {
  const user = await requireUser();
  const canManageBuilds = user.role === "ADMIN" || (user.features ?? []).includes("builds_manage");
  const { scope: rawScope, status } = await searchParams;
  const scope = canManageBuilds && rawScope === "all" ? "all" : "mine";

  const params = new URLSearchParams();
  if (scope === "mine") params.set("assignee", user.id);
  if (status) params.set("status", status);

  const [tasks, users, clients] = await Promise.all([
    serverApi
      .get<BuildTask[] | { results: BuildTask[] }>(`builds/tasks?${params.toString()}`)
      .then(asList)
      .catch(() => [] as BuildTask[]),
    canManageBuilds
      ? serverApi.get<DjangoUser[] | { results: DjangoUser[] }>("auth/users").then(asList).catch(() => [] as DjangoUser[])
      : Promise.resolve([] as DjangoUser[]),
    canManageBuilds
      ? serverApi.get<DjangoClient[] | { results: DjangoClient[] }>("projects/clients").then(asList).catch(() => [] as DjangoClient[])
      : Promise.resolve([] as DjangoClient[]),
  ]);

  const qs = (overrides: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const next = { scope, status, ...overrides };
    if (next.scope && next.scope !== "mine") p.set("scope", next.scope);
    if (next.status) p.set("status", next.status);
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">Task inbox</p>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-950">
            <ListChecks className="h-6 w-6 text-pink-700" /> Tasks
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {scope === "mine" ? "Concerns and tasks assigned to you, across every build." : "Every task across every build."}
          </p>
        </div>
      </div>

      {canManageBuilds && <QuickTaskForm clients={clients} users={users} />}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200/80 bg-white p-3 shadow-sm">
        {canManageBuilds ? (
          <div className="flex gap-1.5 rounded-md bg-slate-100 p-1 text-sm">
            <Link href={qs({ scope: "mine" })} className={`rounded px-3 py-1.5 font-semibold ${scope === "mine" ? "bg-white text-pink-700 shadow-sm" : "text-slate-600"}`}>
              My tasks
            </Link>
            <Link href={qs({ scope: "all" })} className={`rounded px-3 py-1.5 font-semibold ${scope === "all" ? "bg-white text-pink-700 shadow-sm" : "text-slate-600"}`}>
              All tasks
            </Link>
          </div>
        ) : <span />}

        <form method="get" className="flex items-center gap-2">
          {scope === "all" && <input type="hidden" name="scope" value="all" />}
          <span className="text-xs text-slate-500">Status</span>
          <Select name="status" defaultValue={status ?? ""} className="h-9 text-sm">
            <option value="">All</option>
            {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
          </Select>
        </form>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]">
        {tasks.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500">
            {scope === "mine" ? "No tasks assigned to you right now." : "No tasks match this filter."}
          </p>
        ) : (
          <ul className="space-y-2.5 p-5">
            {tasks.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                buildId={t.build ?? ""}
                canManage={canManageBuilds || t.assignee === Number(user.id)}
                canManageBuilds={canManageBuilds}
                users={users}
                showBuildLink
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
