import Link from "next/link";
import { KanbanSquare, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Builds</h1>
          <p className="mt-1 text-sm text-slate-500">Track each client build from draft brief through delivery.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/builds/kanban" className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50">
            <KanbanSquare className="h-4 w-4" />
            Board
          </Link>
          {isAdmin ? (
            <Link href="/builds/new" className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800">
              <Plus className="h-4 w-4" />
              New build
            </Link>
          ) : null}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {builds.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No builds yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Build</th>
                    <th className="px-5 py-3 font-semibold">Client</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 font-semibold">Assignee</th>
                    <th className="px-5 py-3 font-semibold">Tasks</th>
                    <th className="px-5 py-3 font-semibold">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {builds.map((build) => (
                    <tr key={build.id} className="bg-white hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <Link href={`/builds/${build.id}`} className="font-medium text-slate-950 hover:text-blue-700">{build.title}</Link>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{build.client.name}</td>
                      <td className="px-5 py-3"><StatusBadge status={build.status} /></td>
                      <td className="px-5 py-3 text-slate-600">{build.assignee?.name ?? "-"}</td>
                      <td className="px-5 py-3 text-slate-600">{build._count.tasks}</td>
                      <td className="px-5 py-3 text-slate-500">{formatDate(build.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
