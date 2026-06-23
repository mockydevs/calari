import Link from "next/link";
import { List, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import { BUILD_STATUSES, BUILD_STATUS_LABEL, type BuildRow } from "../_shared";

export const dynamic = "force-dynamic";

function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

export default async function BuildsBoardPage() {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const builds = await serverApi
    .get<BuildRow[] | { results: BuildRow[] }>("builds/my-builds")
    .then(asList)
    .catch(() => [] as BuildRow[]);

  const byStatus = Object.fromEntries(
    BUILD_STATUSES.map((s) => [s, builds.filter((b) => b.status === s)]),
  ) as Record<string, BuildRow[]>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Delivery flow</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Status board</h1>
          <p className="mt-1 text-sm text-slate-600">Builds grouped by delivery stage.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/builds" className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-50">
            <List className="h-4 w-4 text-slate-500" /> List
          </Link>
          {isAdmin && (
            <Link href="/builds/new" className="inline-flex h-9 items-center gap-2 rounded-md bg-cyan-700 px-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-cyan-800">
              <Plus className="h-4 w-4" /> New
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {BUILD_STATUSES.map((status) => {
          const cards = byStatus[status] ?? [];
          return (
            <div key={status} className="rounded-lg border border-slate-200 bg-slate-50/60">
              <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                {BUILD_STATUS_LABEL[status]}
                <span className="text-slate-400">{cards.length}</span>
              </div>
              <div className="flex min-h-[60px] flex-col gap-2 p-2.5">
                {cards.length === 0 ? (
                  <p className="py-3 text-center text-xs text-slate-400">—</p>
                ) : (
                  cards.map((b) => (
                    <Link key={b.id} href={`/builds/${b.id}`} className="block rounded-md border border-slate-200 bg-white p-2.5 shadow-sm transition-colors hover:border-cyan-200 hover:bg-cyan-50/30">
                      <p className="text-sm font-semibold text-slate-900">{b.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{b.client_name || "—"}</p>
                      {b.assignee_name && <p className="mt-1 text-[11px] text-slate-400">{b.assignee_name}</p>}
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
