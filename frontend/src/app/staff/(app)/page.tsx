"use client";
import * as React from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Clock,
  Flag,
  FolderKanban,
  ListTodo,
  ShieldAlert,
} from "lucide-react";
import { api } from "@/lib/portal/api";
import { formatDate, isOverdue, timeAgo } from "@/lib/portal/format";
import type { MyDashboard, Project, TaskCard } from "@/lib/portal/types";
import {
  Avatar,
  Card,
  EmptyState,
  PriorityPill,
  ProgressBar,
  SectionTitle,
  Skeleton,
  StatCard,
  StatusDot,
} from "@/components/portal/ui";
import { usePortalUser } from "@/components/portal/user-context";

export default function EmployeeDashboard() {
  const { user } = usePortalUser();
  const [data, setData] = React.useState<MyDashboard | null>(null);
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      try {
        const [dash, projs] = await Promise.all([
          api.get<MyDashboard>("projects/my-dashboard"),
          api.get<Project[] | { results: Project[] }>("projects/my-projects", { status: "active" }),
        ]);
        setData(dash);
        setProjects(Array.isArray(projs) ? projs : projs.results ?? []);
      } catch {
        /* handled by empty states */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const stats = data?.stats;

  return (
    <div className="portal-fade-in">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="portal-page-title">Welcome back, {user?.full_name?.split(" ")[0] || "there"}</h1>
          <p className="portal-page-subtitle">Here&apos;s what&apos;s on your plate today.</p>
        </div>
        <span className="portal-text-muted text-[0.75rem]">{formatDate(new Date().toISOString())}</span>
      </div>

      {/* Stat cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[68px]" />)
        ) : (
          <>
            <StatCard icon={<FolderKanban className="h-4 w-4" />} value={stats?.my_active_projects ?? 0} label="Active Projects" />
            <StatCard icon={<ListTodo className="h-4 w-4" />} value={stats?.my_open_tasks ?? 0} label="Open Tasks" accent="var(--accent-cyan)" />
            <StatCard icon={<AlertTriangle className="h-4 w-4" />} value={stats?.my_overdue_tasks ?? 0} label="Overdue" accent="var(--accent-red)" />
            <StatCard icon={<Flag className="h-4 w-4" />} value={stats?.my_high_priority_tasks ?? 0} label="High Priority" accent="var(--accent-amber)" />
          </>
        )}
      </div>

      {/* Row 2 */}
      <div className="mb-4 grid gap-3 lg:grid-cols-2">
        <Card>
          <SectionTitle icon={<FolderKanban className="h-3.5 w-3.5" />} action={<Link href="/staff/projects" className="text-[0.7rem]" style={{ color: "var(--accent-primary)" }}>View all</Link>}>
            My Projects
          </SectionTitle>
          {loading ? (
            <Skeleton className="h-24" />
          ) : projects.length === 0 ? (
            <EmptyState message="No active projects assigned." />
          ) : (
            <div className="flex flex-col">
              {projects.slice(0, 6).map((p) => (
                <ProjectRow key={p.id} project={p} />
              ))}
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle icon={<Clock className="h-3.5 w-3.5" />}>Due in 7 Days</SectionTitle>
          {loading ? (
            <Skeleton className="h-24" />
          ) : !data?.almost_due_tasks?.length ? (
            <EmptyState message="Nothing due soon. Nice." />
          ) : (
            <div className="flex flex-col">
              {data.almost_due_tasks.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Row 3 */}
      <div className="mb-4 grid gap-3 lg:grid-cols-3">
        <Card>
          <SectionTitle icon={<ListTodo className="h-3.5 w-3.5" />}>My Tasks</SectionTitle>
          {loading ? <Skeleton className="h-24" /> : !data?.my_tasks?.length ? <EmptyState message="No tasks." /> : (
            <div className="flex flex-col">{data.my_tasks.slice(0, 6).map((t) => <TaskRow key={t.id} task={t} />)}</div>
          )}
        </Card>
        <Card>
          <SectionTitle icon={<Flag className="h-3.5 w-3.5" />}>High Priority</SectionTitle>
          {loading ? <Skeleton className="h-24" /> : !data?.high_priority_tasks?.length ? <EmptyState message="None." /> : (
            <div className="flex flex-col">{data.high_priority_tasks.slice(0, 6).map((t) => <TaskRow key={t.id} task={t} />)}</div>
          )}
        </Card>
        <Card>
          <SectionTitle icon={<AlertTriangle className="h-3.5 w-3.5" />}>Overdue</SectionTitle>
          {loading ? <Skeleton className="h-24" /> : !data?.overdue_tasks?.length ? <EmptyState message="Nothing overdue." /> : (
            <div className="flex flex-col">{data.overdue_tasks.slice(0, 6).map((t) => <TaskRow key={t.id} task={t} />)}</div>
          )}
        </Card>
      </div>

      {/* Row 4 */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <SectionTitle icon={<Flag className="h-3.5 w-3.5" />}>Upcoming Milestones</SectionTitle>
          {loading ? <Skeleton className="h-24" /> : !data?.upcoming_milestones?.length ? <EmptyState message="No milestones." /> : (
            <div className="flex flex-col">
              {data.upcoming_milestones.slice(0, 6).map((m) => (
                <div key={m.id} className="flex items-center justify-between border-b py-1.5 text-[0.74rem]" style={{ borderColor: "var(--border)" }}>
                  <span className="flex items-center gap-1.5"><Flag className="h-3 w-3" style={{ color: "var(--accent-violet)" }} />{m.name}</span>
                  <span className="portal-text-muted text-[0.67rem]">{formatDate(m.due_date)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <SectionTitle icon={<ShieldAlert className="h-3.5 w-3.5" />}>Active Blockers</SectionTitle>
          {loading ? <Skeleton className="h-24" /> : !data?.active_blockers?.length ? <EmptyState message="No blockers." /> : (
            <div className="flex flex-col gap-2">
              {data.active_blockers.slice(0, 5).map((b) => (
                <div key={b.id} className="rounded-md p-2 text-[0.74rem]" style={{ background: "rgba(239,68,68,0.08)" }}>
                  <div className="portal-text-muted mb-0.5 text-[0.65rem]">{b.project_name}</div>
                  {b.description}
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <SectionTitle icon={<Activity className="h-3.5 w-3.5" />}>Recent Activity</SectionTitle>
          {loading ? <Skeleton className="h-24" /> : !data?.recent_activity?.length ? <EmptyState message="No recent activity." /> : (
            <div className="flex flex-col gap-2">
              {data.recent_activity.slice(0, 6).map((a) => (
                <div key={a.id} className="flex items-start gap-2 text-[0.73rem]">
                  <Avatar name={a.user_name} size="xs" />
                  <div className="min-w-0">
                    <span className="font-medium">{a.user_name || "Someone"}</span>{" "}
                    <span className="portal-text-muted">{a.action}</span>
                    <div className="portal-text-muted text-[0.65rem]">{timeAgo(a.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function ProjectRow({ project }: { project: Project }) {
  const pct = project.progress_percent ?? 0;
  return (
    <Link
      href={`/staff/projects/${project.id}`}
      className="flex flex-col gap-1 border-b py-2 last:border-0"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[0.78rem] font-semibold">{project.name}</span>
        <span className="portal-text-muted text-[0.67rem]">{pct}%</span>
      </div>
      <ProgressBar percent={pct} className="!h-[3px]" />
      <span className="portal-text-muted text-[0.65rem]">{project.client_name}</span>
    </Link>
  );
}

function TaskRow({ task }: { task: TaskCard }) {
  return (
    <div className="flex items-center gap-2 border-b py-1.5 last:border-0" style={{ borderColor: "var(--border)" }}>
      <StatusDot status={task.status} />
      <span className="flex-1 truncate text-[0.74rem]">{task.name}</span>
      {task.priority && <PriorityPill priority={task.priority} />}
      {task.due_date && (
        <span className="text-[0.65rem]" style={{ color: isOverdue(task.due_date) ? "var(--accent-red)" : "var(--text-muted)" }}>
          {formatDate(task.due_date)}
        </span>
      )}
      {task.assigned_to_name && <Avatar name={task.assigned_to_name} size="xs" />}
    </div>
  );
}
