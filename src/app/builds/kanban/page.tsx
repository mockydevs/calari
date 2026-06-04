import Link from "next/link";
import { List, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { StatusBadge } from "@/components/status-badge";
import { formatDate } from "@/lib/utils";
import type { BuildStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const COLUMNS: { status: BuildStatus; label: string }[] = [
  { status: "DRAFT", label: "Draft" },
  { status: "AI_DRAFTED", label: "AI Drafted" },
  { status: "ASSIGNED", label: "Assigned" },
  { status: "IN_PROGRESS", label: "In Progress" },
  { status: "READY_FOR_REVIEW", label: "For Review" },
  { status: "CHANGES_REQUESTED", label: "Changes" },
  { status: "DELIVERED", label: "Delivered" },
];

export default async function KanbanPage() {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";

  const builds = await prisma.build.findMany({
    where: isAdmin ? {} : { assigneeId: user.id },
    include: { client: true, assignee: true, _count: { select: { tasks: true } } },
    orderBy: { updatedAt: "desc" },
  });

  const byStatus = Object.fromEntries(
    COLUMNS.map(({ status }) => [status, builds.filter((build) => build.status === status)]),
  ) as Record<BuildStatus, typeof builds>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Status board</h1>
          <p className="mt-1 text-sm text-slate-500">Scan workload by delivery stage.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/builds" className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50">
            <List className="h-4 w-4" />
            List
          </Link>
          {isAdmin ? (
            <Link href="/builds/new" className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800">
              <Plus className="h-4 w-4" />
              New build
            </Link>
          ) : null}
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-4">
        {COLUMNS.map(({ status, label }) => {
          const cards = byStatus[status] ?? [];
          return (
            <div key={status} className="flex w-64 shrink-0 flex-col gap-2">
              <div className="flex items-center justify-between rounded-md bg-white px-3 py-2 ring-1 ring-slate-200">
                <div>
                  <p className="text-xs font-semibold text-slate-500">{label}</p>
                  <StatusBadge status={status} />
                </div>
                <span className="text-xs text-slate-400">{cards.length}</span>
              </div>
              <div className="flex min-h-40 flex-col gap-2 rounded-md bg-slate-100 p-2">
                {cards.length === 0 ? (
                  <div className="rounded-md border border-dashed border-slate-300 bg-white/60 px-3 py-4 text-center text-xs text-slate-400">
                    Empty
                  </div>
                ) : (
                  cards.map((build) => (
                    <Link
                      key={build.id}
                      href={`/builds/${build.id}`}
                      className="block rounded-md border border-slate-200 bg-white p-3 transition-colors hover:border-blue-300 hover:bg-blue-50"
                    >
                      <p className="text-sm font-medium leading-snug text-slate-950">{build.title}</p>
                      <p className="mt-1 text-xs text-slate-500">{build.client.name}</p>
                      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
                        <span>{build._count.tasks} task{build._count.tasks !== 1 ? "s" : ""}</span>
                        <span className="max-w-24 truncate">{build.assignee?.name ?? "Unassigned"}</span>
                      </div>
                      {build.dueDate ? <p className="mt-1 text-xs text-slate-400">{formatDate(build.dueDate)}</p> : null}
                    </Link>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
