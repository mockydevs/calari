import { notFound } from "next/navigation";
import { GitBranch, ListChecks, Target } from "lucide-react";
import { DJANGO_API } from "@/lib/portal/config";
import { FeedbackForm } from "./feedback-form";

export const dynamic = "force-dynamic";

type Stage = { id: number; name: string; order: number; description?: string; is_automatic?: boolean };
type Task = { id: number; title: string; status: string };
type PortalBuild = {
  title: string;
  status: string;
  goals: string;
  integrations: string;
  stages: Stage[];
  tasks: Task[];
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "In setup", AI_DRAFTED: "In setup", ASSIGNED: "In progress", IN_PROGRESS: "In progress",
  READY_FOR_REVIEW: "In review", CHANGES_REQUESTED: "In review", DELIVERED: "Delivered",
};
const TASK_LABEL: Record<string, string> = {
  TODO: "To do", IN_PROGRESS: "In progress", BLOCKED: "Blocked", IN_REVIEW: "In review", DONE: "Done",
};
const TASK_STYLE: Record<string, string> = {
  DONE: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  IN_PROGRESS: "bg-amber-50 text-amber-700 ring-amber-200",
  IN_REVIEW: "bg-violet-50 text-violet-700 ring-violet-200",
  BLOCKED: "bg-red-50 text-red-700 ring-red-200",
  TODO: "bg-slate-100 text-slate-600 ring-slate-200",
};

async function getBuild(token: string): Promise<PortalBuild | null> {
  try {
    const res = await fetch(`${DJANGO_API}/builds/portal/${encodeURIComponent(token)}/build/`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as PortalBuild;
  } catch {
    return null;
  }
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5 text-sm font-semibold text-slate-950">{icon}{title}</div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export default async function ClientPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const build = await getBuild(token);
  if (!build) notFound();

  const integrations = build.integrations ? build.integrations.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const stages = [...(build.stages ?? [])].sort((a, b) => a.order - b.order);
  const tasks = build.tasks ?? [];
  const done = tasks.filter((t) => t.status === "DONE").length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#fdf2f8_0%,#f8fafc_42%,#eef2f7_100%)] px-6 py-12 text-slate-950">
      <div className="mx-auto w-full max-w-3xl space-y-5">
        <header className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-lg font-bold tracking-tight text-slate-950">Calari<span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-pink-600 align-middle" /></span>
            <span className="rounded-full bg-pink-50 px-3 py-1 text-xs font-semibold text-pink-700 ring-1 ring-pink-100">{STATUS_LABEL[build.status] ?? build.status}</span>
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">{build.title}</h1>
          <p className="mt-1 text-sm text-slate-500">Your build progress, shared by the Calari team.</p>
          {tasks.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
                <span>Progress</span><span>{done}/{tasks.length} tasks · {pct}%</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                <div className={`h-full rounded-full ${pct === 100 ? "bg-emerald-500" : "bg-gradient-to-r from-pink-500 to-fuchsia-500"}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
        </header>

        {build.goals && (
          <Card title="Goals" icon={<Target className="h-4 w-4 text-pink-700" />}>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{build.goals}</p>
          </Card>
        )}

        {integrations.length > 0 && (
          <Card title="Integrations" icon={<GitBranch className="h-4 w-4 text-pink-700" />}>
            <div className="flex flex-wrap gap-1.5">{integrations.map((i) => <span key={i} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{i}</span>)}</div>
          </Card>
        )}

        {stages.length > 0 && (
          <Card title="Pipeline" icon={<GitBranch className="h-4 w-4 text-pink-700" />}>
            <ol className="space-y-2">{stages.map((s) => (
              <li key={s.id} className="rounded-md border border-slate-200 p-2.5 text-sm">
                <p className="font-medium text-slate-800">{s.order}. {s.name}</p>
                {s.description && <p className="mt-0.5 text-xs text-slate-500">{s.description}</p>}
              </li>
            ))}</ol>
          </Card>
        )}

        {tasks.length > 0 && (
          <Card title="Work items" icon={<ListChecks className="h-4 w-4 text-pink-700" />}>
            <ul className="divide-y divide-slate-100">{tasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="text-slate-800">{t.title}</span>
                <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${TASK_STYLE[t.status] ?? TASK_STYLE.TODO}`}>{TASK_LABEL[t.status] ?? t.status}</span>
              </li>
            ))}</ul>
          </Card>
        )}

        <Card title="Feedback" icon={<ListChecks className="h-4 w-4 text-pink-700" />}>
          <FeedbackForm token={token} />
        </Card>

        <p className="pb-6 text-center text-xs text-slate-400">© {new Date().getFullYear()} Calari Solutions</p>
      </div>
    </div>
  );
}
