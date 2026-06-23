"use client";
import * as React from "react";
import Link from "next/link";
import {
  Bug,
  Building2,
  CheckCheck,
  CheckCircle2,
  FolderKanban,
  FolderPlus,
  ListTodo,
  PauseCircle,
  ShieldAlert,
  UserCheck,
  Users,
  XCircle,
} from "lucide-react";
import { api, extractApiError } from "@/lib/portal/api";
import { formatDate } from "@/lib/portal/format";
import type { Client, DashboardStats, Project, ProjectBlocker, TaskBlocker, TaskCard } from "@/lib/portal/types";
import { Button } from "@/components/portal/button";
import { Modal } from "@/components/portal/modal";
import { useToast } from "@/components/portal/toast";
import { Avatar, Card, EmptyState, PriorityBadge, Skeleton, StatCard, StatusBadge } from "@/components/portal/ui";

function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

export default function AdminDashboard() {
  const toast = useToast();
  const [stats, setStats] = React.useState<DashboardStats | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [blockersOpen, setBlockersOpen] = React.useState(false);

  React.useEffect(() => {
    api.get<DashboardStats>("projects/dashboard-stats")
      .then(setStats)
      .catch((e) => toast(extractApiError((e as { body?: unknown }).body, "Failed to load stats."), "danger"))
      .finally(() => setLoading(false));
  }, [toast]);

  if (loading) return <div className="grid gap-3 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[68px]" />)}</div>;

  const p = stats?.projects;
  const u = stats?.users;
  const c = stats?.clients;
  const t = stats?.tasks;

  return (
    <div className="portal-fade-in space-y-4">
      <div>
        <h1 className="portal-page-title">Admin Dashboard</h1>
        <p className="portal-page-subtitle">System-wide overview of projects, people, and operations.</p>
      </div>

      {/* Project stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard icon={<FolderKanban className="h-4 w-4" />} value={p?.total ?? 0} label="Total" />
        <StatCard icon={<CheckCircle2 className="h-4 w-4" />} value={p?.active ?? 0} label="Active" accent="var(--accent-green)" />
        <StatCard icon={<CheckCheck className="h-4 w-4" />} value={p?.completed ?? 0} label="Completed" accent="var(--accent-primary)" />
        <StatCard icon={<PauseCircle className="h-4 w-4" />} value={p?.on_hold ?? 0} label="On Hold" accent="var(--accent-amber)" />
        <StatCard icon={<ShieldAlert className="h-4 w-4" />} value={p?.overdue ?? 0} label="Overdue" accent="var(--accent-red)" />
        <StatCard icon={<XCircle className="h-4 w-4" />} value={p?.cancelled ?? 0} label="Cancelled" accent="var(--text-muted)" />
      </div>

      {/* Ops + Users */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="grid grid-cols-2 gap-3">
          <StatCard icon={<Building2 className="h-4 w-4" />} value={c?.total ?? 0} label="Clients" />
          <StatCard icon={<UserCheck className="h-4 w-4" />} value={c?.active ?? 0} label="Active Clients" accent="var(--accent-green)" />
          <StatCard icon={<ListTodo className="h-4 w-4" />} value={t?.total ?? 0} label="Total Tasks" accent="var(--accent-cyan)" />
          <StatCard icon={<ListTodo className="h-4 w-4" />} value={t?.pending ?? 0} label="Pending Tasks" accent="var(--accent-amber)" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard icon={<Users className="h-4 w-4" />} value={u?.total ?? 0} label="Users" />
          <StatCard icon={<UserCheck className="h-4 w-4" />} value={u?.active ?? 0} label="Active" accent="var(--accent-green)" />
          <StatCard icon={<Users className="h-4 w-4" />} value={u?.inactive ?? 0} label="Inactive" accent="var(--accent-red)" />
          <StatCard icon={<ShieldAlert className="h-4 w-4" />} value={stats?.blockers?.project_open ?? 0} label="Project Blockers" accent="var(--accent-red)" />
          <StatCard icon={<Bug className="h-4 w-4" />} value={stats?.blockers?.task_open ?? 0} label="Task Blockers" accent="var(--accent-red)" />
          <StatCard icon={<CheckCheck className="h-4 w-4" />} value={t?.completed ?? 0} label="Tasks Done" accent="var(--accent-green)" />
        </div>
      </div>

      {/* Quick actions */}
      <Card>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <QuickAction href="/staff/settings?tab=clients" icon={<Building2 className="h-5 w-5" />} label="Add Client" />
          <QuickAction href="/staff/projects" icon={<FolderPlus className="h-5 w-5" />} label="New Project" />
          <QuickAction href="/staff/projects" icon={<FolderKanban className="h-5 w-5" />} label="All Projects" />
          <button className="portal-card flex flex-col items-center gap-1.5 p-3 text-[0.7rem] font-semibold" onClick={() => setBlockersOpen(true)}>
            <ShieldAlert className="h-5 w-5" style={{ color: "var(--accent-primary)" }} /> View Blockers
          </button>
        </div>
      </Card>

      {/* Recent projects */}
      {!!stats?.recent_projects?.length && (
        <Card>
          <h3 className="mb-3 flex items-center gap-1.5 text-[0.72rem] font-bold uppercase tracking-wide"><FolderKanban className="h-3.5 w-3.5" /> Recent Projects</h3>
          <div className="overflow-x-auto">
            <table className="portal-table">
              <thead><tr><th>Project</th><th>Client</th><th>Status</th><th>Priority</th><th>Due</th></tr></thead>
              <tbody>
                {stats.recent_projects.map((pr: Project) => (
                  <tr key={pr.id}>
                    <td><Link href={`/staff/projects/${pr.id}`} className="font-semibold">{pr.name}</Link></td>
                    <td className="portal-text-muted">{pr.client_name || "—"}</td>
                    <td><StatusBadge status={pr.status} /></td>
                    <td><PriorityBadge priority={pr.priority} /></td>
                    <td className="portal-text-muted whitespace-nowrap">{formatDate(pr.end_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Recent tasks + workload */}
      <div className="grid gap-3 lg:grid-cols-2">
        {!!stats?.recent_tasks?.length && (
          <Card>
            <h3 className="mb-3 text-[0.72rem] font-bold uppercase tracking-wide">Recent Tasks</h3>
            <div className="flex flex-col">
              {stats.recent_tasks.map((tk: TaskCard) => (
                <div key={tk.id} className="flex items-center justify-between border-b py-1.5 text-[0.76rem] last:border-0" style={{ borderColor: "var(--border)" }}>
                  <span className="truncate">{tk.name}</span>
                  <PriorityBadge priority={tk.priority} />
                </div>
              ))}
            </div>
          </Card>
        )}
        {!!stats?.staff_workload?.length && (
          <Card>
            <h3 className="mb-3 text-[0.72rem] font-bold uppercase tracking-wide">Staff Workload</h3>
            <div className="flex flex-col">
              {stats.staff_workload.map((w, i) => (
                <div key={i} className="flex items-center gap-2 border-b py-1.5 last:border-0" style={{ borderColor: "var(--border)" }}>
                  <Avatar name={w.user} size="sm" />
                  <span className="flex-1 text-[0.76rem]">{w.user}</span>
                  <span className="rounded-full px-2 py-0.5 text-[0.7rem] font-bold" style={{ background: "var(--bg-elevated)" }}>{w.open_tasks}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {!stats?.recent_projects?.length && <Card><EmptyState message="No recent activity to display." /></Card>}

      {blockersOpen && <BlockersModal onClose={() => setBlockersOpen(false)} />}
    </div>
  );
}

function QuickAction({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href} className="portal-card flex flex-col items-center gap-1.5 p-3 text-[0.7rem] font-semibold">
      <span style={{ color: "var(--accent-primary)" }}>{icon}</span>
      {label}
    </Link>
  );
}

function BlockersModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [proj, setProj] = React.useState<ProjectBlocker[]>([]);
  const [tasks, setTasks] = React.useState<TaskBlocker[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    try {
      const [pb, tb] = await Promise.all([
        api.get<ProjectBlocker[] | { results: ProjectBlocker[] }>("projects/project-blockers", { resolved: false, ordering: "-created_at" }),
        api.get<TaskBlocker[] | { results: TaskBlocker[] }>("projects/task-blockers", { resolved: false, ordering: "-created_at" }),
      ]);
      setProj(asList(pb)); setTasks(asList(tb));
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  async function resolveProject(b: ProjectBlocker) {
    try { await api.patch(`projects/project-blockers/${b.id}`, { resolved: true }); setProj((x) => x.filter((i) => i.id !== b.id)); toast("Resolved.", "success"); } catch (e) { toast(extractApiError((e as { body?: unknown }).body), "danger"); }
  }
  async function resolveTask(b: TaskBlocker) {
    try { await api.patch(`projects/task-blockers/${b.id}`, { resolved: true }); setTasks((x) => x.filter((i) => i.id !== b.id)); toast("Resolved.", "success"); } catch (e) { toast(extractApiError((e as { body?: unknown }).body), "danger"); }
  }

  return (
    <Modal open onClose={onClose} title="Open Blockers" size="lg">
      {loading ? <Skeleton className="h-32" /> : proj.length === 0 && tasks.length === 0 ? (
        <EmptyState icon={<CheckCircle2 className="h-8 w-8" />} message="No open blockers. All clear!" />
      ) : (
        <div className="space-y-4">
          {proj.length > 0 && (
            <div>
              <div className="portal-label">Project blockers</div>
              <div className="flex flex-col gap-2">
                {proj.map((b) => (
                  <div key={b.id} className="flex items-start justify-between gap-2 rounded-md p-2.5 text-[0.76rem]" style={{ background: "rgba(239,68,68,0.08)" }}>
                    <div><div className="portal-text-muted text-[0.63rem]">{b.project_name}</div>{b.description}</div>
                    <Button size="sm" variant="secondary" onClick={() => resolveProject(b)}>Resolve</Button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {tasks.length > 0 && (
            <div>
              <div className="portal-label">Task blockers</div>
              <div className="flex flex-col gap-2">
                {tasks.map((b) => (
                  <div key={b.id} className="flex items-start justify-between gap-2 rounded-md p-2.5 text-[0.76rem]" style={{ background: "rgba(239,68,68,0.08)" }}>
                    <div><div className="portal-text-muted text-[0.63rem]">{b.project_name} · {b.task_name}</div>{b.description}</div>
                    <Button size="sm" variant="secondary" onClick={() => resolveTask(b)}>Resolve</Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
