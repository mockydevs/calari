import Link from "next/link";
import { KanbanSquare, Plus, Rows3 } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { StatusBadge } from "@/components/status-badge";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function BuildsPage() {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const builds = await prisma.build.findMany({
    where: isAdmin ? {} : { assigneeId: user.id },
    include: { client: true, assignee: true, _count: { select: { tasks: true } } },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
            Delivery records
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Builds</h1>
          <p className="mt-1 text-sm text-slate-600">
            Track each client build from draft brief through delivery.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/builds/kanban"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition-colors duration-200 hover:border-slate-400 hover:bg-slate-50"
          >
            <KanbanSquare className="h-4 w-4 text-slate-500" />
            Board view
          </Link>
          {isAdmin && (
            <Link
              href="/builds/new"
              className="inline-flex h-9 items-center gap-2 rounded-md bg-cyan-700 px-4 text-sm font-semibold text-white shadow-sm shadow-cyan-900/10 transition-colors duration-200 hover:bg-cyan-800"
            >
              <Plus className="h-4 w-4" />
              New build
            </Link>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]">
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
                className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-cyan-700 px-3 text-xs font-semibold text-white hover:bg-cyan-800"
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
                    <th
                      key={h}
                      className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {builds.map((build) => (
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
      </div>
    </div>
  );
}
