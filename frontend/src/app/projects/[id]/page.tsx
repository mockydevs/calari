import Link from "next/link";
import { ArrowLeft, Calendar, Check, Flag, KanbanSquare, Plus, ShieldAlert, Trash2, Users } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import {
  PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  type Project,
  type ProjectActivity,
} from "@/lib/portal/types";
import { ProjectFormButton, type Option } from "../project-form";
import { ProjectDeleteButton } from "../project-delete-button";
import {
  addBlocker, addContact, addMilestone, completeMilestone, deleteContact, deleteMilestone, resolveBlocker,
} from "../actions";

export const dynamic = "force-dynamic";

type ClientRow = { id: number; name: string };
type UserRow = { id: number; full_name?: string; username?: string };

const iconBtn = "inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100";
const addInput = "h-8 flex-1 rounded-md border border-slate-300 px-2.5 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  on_hold: "bg-amber-50 text-amber-700 ring-amber-200",
  completed: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  cancelled: "bg-red-50 text-red-700 ring-red-200",
};
const PRIORITY_STYLE: Record<string, string> = {
  low: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  medium: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  high: "bg-amber-50 text-amber-700 ring-amber-200",
  critical: "bg-red-50 text-red-700 ring-red-200",
};

function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset ${cls}`}>
      {label}
    </span>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/[0.03]">
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const { id } = await params;

  const project = await serverApi.get<Project>(`projects/projects/${id}`).catch(() => null);
  if (!project) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        Project not found.{" "}
        <Link href="/projects" className="font-semibold text-cyan-700">Back to projects</Link>
      </div>
    );
  }
  const [activity, clients, users] = await Promise.all([
    serverApi.get<ProjectActivity[] | { results: ProjectActivity[] }>(`projects/project-activity?project=${id}`).then(asList).catch(() => [] as ProjectActivity[]),
    isAdmin ? serverApi.get<ClientRow[] | { results: ClientRow[] }>("projects/clients").then(asList).catch(() => [] as ClientRow[]) : Promise.resolve([] as ClientRow[]),
    isAdmin ? serverApi.get<UserRow[] | { results: UserRow[] }>("auth/users").then(asList).catch(() => [] as UserRow[]) : Promise.resolve([] as UserRow[]),
  ]);
  const clientOptions: Option[] = clients.map((c) => ({ id: c.id, name: c.name }));
  const userOptions: Option[] = users.map((u) => ({ id: u.id, name: u.full_name || u.username || `User #${u.id}` }));

  const tasks = project.tasks ?? [];
  const counts = { todo: 0, in_progress: 0, in_review: 0, done: 0 } as Record<string, number>;
  tasks.forEach((t) => (counts[t.status] = (counts[t.status] ?? 0) + 1));

  return (
    <div className="space-y-5">
      <Link href="/projects" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Projects
      </Link>

      {/* Header */}
      <div className="rounded-lg border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/[0.03]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-1.5 flex items-center gap-2">
              <Badge label={PROJECT_STATUS_LABELS[project.status] ?? project.status} cls={STATUS_STYLE[project.status] ?? ""} />
              <Badge label={PRIORITY_LABELS[project.priority] ?? project.priority} cls={PRIORITY_STYLE[project.priority] ?? ""} />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{project.name}</h1>
            <p className="mt-1 text-sm text-slate-600">{project.client_name || "No client"}</p>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
              <Calendar className="h-3.5 w-3.5" /> {project.start_date} → {project.end_date}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && <ProjectFormButton clients={clientOptions} users={userOptions} project={project} />}
            <Link
              href={`/projects/${id}/board`}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-cyan-700 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-cyan-800"
            >
              <KanbanSquare className="h-4 w-4" /> Task board
            </Link>
            {isAdmin && <ProjectDeleteButton id={project.id} name={project.name} />}
          </div>
        </div>
        {project.description && <p className="mt-4 text-sm leading-relaxed text-slate-700">{project.description}</p>}
      </div>

      {/* Task summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([["To Do", "todo"], ["In Progress", "in_progress"], ["In Review", "in_review"], ["Done", "done"]] as const).map(
          ([label, key]) => (
            <div key={key} className="rounded-lg border border-slate-200/80 bg-white p-4 shadow-sm">
              <p className="text-2xl font-semibold tabular-nums text-slate-950">{counts[key] ?? 0}</p>
              <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
            </div>
          ),
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <Panel title="Milestones" icon={<Flag className="h-3.5 w-3.5" />}>
            {(project.milestones ?? []).length === 0 ? (
              <p className="text-sm text-slate-400">No milestones.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {project.milestones!.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <form action={completeMilestone}>
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="projectId" value={id} />
                        <input type="hidden" name="completed" value={String(m.completed)} />
                        <button className={`flex h-5 w-5 items-center justify-center rounded border ${m.completed ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 text-transparent hover:border-cyan-500"}`} aria-label="Toggle complete">
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      </form>
                      <span className={m.completed ? "text-slate-400 line-through" : "text-slate-800"}>{m.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">{m.due_date}</span>
                      {isAdmin && (
                        <form action={deleteMilestone}>
                          <input type="hidden" name="id" value={m.id} />
                          <input type="hidden" name="projectId" value={id} />
                          <button className={iconBtn} aria-label="Delete milestone"><Trash2 className="h-3.5 w-3.5" /></button>
                        </form>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <form action={addMilestone} className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
              <input type="hidden" name="projectId" value={id} />
              <input name="name" required placeholder="New milestone…" className={addInput} />
              <input name="due_date" type="date" className="h-8 rounded-md border border-slate-300 px-2 text-sm" />
              <button className="inline-flex h-8 items-center gap-1 rounded-md bg-cyan-700 px-2.5 text-xs font-semibold text-white hover:bg-cyan-800"><Plus className="h-3.5 w-3.5" /> Add</button>
            </form>
          </Panel>
          <Panel title="Contacts" icon={<Users className="h-3.5 w-3.5" />}>
            {(project.contacts ?? []).length === 0 ? (
              <p className="text-sm text-slate-400">No contacts.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {project.contacts!.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-2 py-2 text-sm">
                    <div>
                      <span className="font-medium text-slate-800">{c.name}</span>
                      {c.role && <span className="text-slate-500"> · {c.role}</span>}
                      <span className="block text-xs text-slate-400">{c.email}{c.phone_number ? ` · ${c.phone_number}` : ""}</span>
                    </div>
                    {isAdmin && (
                      <form action={deleteContact}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="projectId" value={id} />
                        <button className={iconBtn} aria-label="Delete contact"><Trash2 className="h-3.5 w-3.5" /></button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <form action={addContact} className="mt-3 grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-2">
              <input type="hidden" name="projectId" value={id} />
              <input name="name" required placeholder="Name" className={addInput} />
              <input name="role" placeholder="Role" className={addInput} />
              <input name="email" type="email" placeholder="Email" className={addInput} />
              <input name="phone_number" placeholder="Phone" className={addInput} />
              <button className="inline-flex h-8 items-center justify-center gap-1 rounded-md bg-cyan-700 px-2.5 text-xs font-semibold text-white hover:bg-cyan-800 sm:col-span-2"><Plus className="h-3.5 w-3.5" /> Add contact</button>
            </form>
          </Panel>
        </div>

        <div className="space-y-3">
          <Panel title="Blockers" icon={<ShieldAlert className="h-3.5 w-3.5" />}>
            {(project.blockers ?? []).filter((b) => !b.resolved).length === 0 ? (
              <p className="text-sm text-slate-400">No active blockers.</p>
            ) : (
              <ul className="space-y-2">
                {project.blockers!.filter((b) => !b.resolved).map((b) => (
                  <li key={b.id} className="flex items-start justify-between gap-2 rounded-md bg-red-50 p-2.5 text-sm text-red-800">
                    <span>{b.description}</span>
                    <form action={resolveBlocker}>
                      <input type="hidden" name="id" value={b.id} />
                      <input type="hidden" name="projectId" value={id} />
                      <button className="shrink-0 rounded px-1.5 text-xs font-semibold text-red-700 hover:bg-red-100" aria-label="Resolve blocker">Resolve</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <form action={addBlocker} className="mt-3 flex items-center gap-2 border-t border-red-100 pt-3">
              <input type="hidden" name="projectId" value={id} />
              <input name="description" required placeholder="Report a blocker…" className={addInput} />
              <button className="inline-flex h-8 items-center gap-1 rounded-md bg-red-600 px-2.5 text-xs font-semibold text-white hover:bg-red-700"><Plus className="h-3.5 w-3.5" /> Add</button>
            </form>
          </Panel>
          <Panel title="Team" icon={<Users className="h-3.5 w-3.5" />}>
            {(project.co_assignments ?? []).length === 0 ? (
              <p className="text-sm text-slate-400">No team members.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {project.co_assignments!.map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-slate-800">{c.user_name}</span>
                    <span className="text-xs capitalize text-slate-400">{c.role}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Recent activity" icon={<Calendar className="h-3.5 w-3.5" />}>
            {activity.length === 0 ? (
              <p className="text-sm text-slate-400">No activity.</p>
            ) : (
              <ul className="space-y-2">
                {activity.slice(0, 8).map((a) => (
                  <li key={a.id} className="text-xs text-slate-600">
                    <span className="font-medium text-slate-800">{a.user_name || "Someone"}</span> {a.action}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
