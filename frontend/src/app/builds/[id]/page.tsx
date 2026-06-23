import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import { assignBuild, createTask, setBuildStatus, updateTaskStatus } from "../actions";
import {
  BUILD_STATUSES,
  BUILD_STATUS_LABEL,
  BuildStatusBadge,
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  TASK_TYPES,
  type BuildDetail,
} from "../_shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

type DjangoUser = { id: number; full_name: string; username: string };

function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

export default async function BuildDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";

  const build = await serverApi.get<BuildDetail>(`builds/builds/${id}`).catch(() => null);
  if (!build) notFound();

  const users = isAdmin
    ? await serverApi
        .get<DjangoUser[] | { results: DjangoUser[] }>("auth/users")
        .then(asList)
        .catch(() => [] as DjangoUser[])
    : [];
  const tasks = build.tasks ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <Link href="/builds" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Builds
      </Link>

      {/* Header */}
      <section className="rounded-lg border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/[0.03]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-1.5"><BuildStatusBadge status={build.status} /></div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{build.title}</h1>
            <p className="mt-1 text-sm text-slate-600">{build.client_name || "No client"}</p>
            <p className="mt-1 text-xs text-slate-400">
              Assignee: {build.assignee_name || "Unassigned"}
            </p>
          </div>
          <form action={setBuildStatus} className="flex items-end gap-2">
            <input type="hidden" name="id" value={id} />
            <div className="space-y-1">
              <Label htmlFor="status" className="text-xs">Status</Label>
              <Select id="status" name="status" defaultValue={build.status} className="h-9">
                {BUILD_STATUSES.map((s) => (
                  <option key={s} value={s}>{BUILD_STATUS_LABEL[s]}</option>
                ))}
              </Select>
            </div>
            <Button type="submit" size="sm" variant="outline">Update</Button>
          </form>
        </div>

        {isAdmin && (
          <form action={assignBuild} className="mt-4 flex items-end gap-2 border-t border-slate-100 pt-4">
            <input type="hidden" name="id" value={id} />
            <div className="space-y-1">
              <Label htmlFor="assigneeId" className="text-xs">Assign to</Label>
              <Select id="assigneeId" name="assigneeId" defaultValue="" className="h-9">
                <option value="" disabled>Select member</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name || u.username}</option>
                ))}
              </Select>
            </div>
            <Button type="submit" size="sm">Assign</Button>
          </form>
        )}
      </section>

      {/* Tasks */}
      <section className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-950">Tasks</h2>
        </div>

        {tasks.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">No tasks yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {tasks.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{t.title}</p>
                  <p className="text-xs text-slate-400">{t.type}</p>
                </div>
                <form action={updateTaskStatus} className="flex items-center gap-2">
                  <input type="hidden" name="taskId" value={t.id} />
                  <input type="hidden" name="buildId" value={id} />
                  <Select name="status" defaultValue={t.status} className="h-8 text-xs">
                    {TASK_STATUSES.map((s) => (
                      <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>
                    ))}
                  </Select>
                  <Button type="submit" size="sm" variant="outline">Set</Button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <form action={createTask} className="flex flex-wrap items-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-4">
          <input type="hidden" name="buildId" value={id} />
          <div className="flex-1 space-y-1">
            <Label htmlFor="title" className="text-xs">New task</Label>
            <Input id="title" name="title" required placeholder="Task title" className="h-9" />
          </div>
          <Select name="type" defaultValue="OTHER" className="h-9">
            {TASK_TYPES.map((t) => (
              <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>
            ))}
          </Select>
          <Button type="submit" size="sm"><Plus className="h-3.5 w-3.5" /> Add</Button>
        </form>
      </section>
    </div>
  );
}
