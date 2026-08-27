import Link from "next/link";
import { KanbanSquare, Plus, Rows3, ArrowRight } from "lucide-react";
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
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Client delivery / GHL</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">From meeting to execution.</h1>
          <p className="mt-2 text-sm text-slate-500">Turn client conversations into a clear, assigned GHL task list.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {user.role === "ADMIN" && <Link href="/settings/fathom" className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Fathom inbox</Link>}
          <Link href="/builds/kanban" className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-50">
            <KanbanSquare className="h-4 w-4 text-slate-500" />
            Board view
          </Link>
          {isAdmin && (
            <Link href="/builds/new" className="inline-flex h-9 items-center gap-2 rounded-md bg-pink-700 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-pink-800">
              <Plus className="h-4 w-4" />
              New GHL meeting
            </Link>
          )}
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="grid divide-y divide-slate-100 md:grid-cols-3 md:divide-x md:divide-y-0">
          {[{ title: "01 · Capture the meeting", text: "Paste notes or upload a transcript to a client build." }, { title: "02 · Review the AI task list", text: "Automations, pipelines, tags, funnels, forms, and email copy." }, { title: "03 · Assign and deliver", text: "Approve tasks, choose staff, set deadlines, and track progress." }].map(step => <div key={step.title} className="p-6"><h2 className="text-sm font-semibold">{step.title}</h2><p className="mt-2 text-xs leading-5 text-slate-500">{step.text}</p></div>)}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/70 px-6 py-3"><p className="text-xs text-slate-500">AI suggestions stay in review until you assign them.</p><Link href="/tasks?kind=ghl" className="flex items-center gap-2 text-xs font-semibold text-pink-700">View assigned GHL tasks <ArrowRight className="h-3.5 w-3.5" /></Link></div>
      </section>

      <h2 className="text-lg font-semibold">Client builds <span className="ml-1 text-sm font-normal text-slate-400">{builds.length}</span></h2>

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
