import Link from "next/link";
import { KanbanSquare, Plus, Rows3 } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import { type BuildRow } from "./_shared";
import { BuildsTable } from "./builds-table";

export const dynamic = "force-dynamic";

function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

export default async function BuildsPage() {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN" || (user.features ?? []).includes("builds_manage");
  const builds = await serverApi
    .get<BuildRow[] | { results: BuildRow[] }>("builds/my-builds")
    .then(asList)
    .catch(() => [] as BuildRow[]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">Delivery records</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Builds</h1>
          <p className="mt-1 text-sm text-slate-600">Track each client build from draft through delivery.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/builds/kanban" className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-50">
            <KanbanSquare className="h-4 w-4 text-slate-500" />
            Board view
          </Link>
          {isAdmin && (
            <Link href="/builds/new" className="inline-flex h-9 items-center gap-2 rounded-md bg-pink-700 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-pink-800">
              <Plus className="h-4 w-4" />
              New build
            </Link>
          )}
        </div>
      </div>

      {builds.length === 0 ? (
        <div className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]">
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100">
              <Rows3 className="h-5 w-5 text-slate-400" />
            </div>
            <p className="mt-3 text-sm font-semibold text-slate-950">No builds yet</p>
            <p className="mt-1 text-xs text-slate-500">
              {isAdmin ? "Create your first build to get started." : "You have not been assigned any builds."}
            </p>
          </div>
        </div>
      ) : (
        <BuildsTable builds={builds} isAdmin={isAdmin} />
      )}
    </div>
  );
}
