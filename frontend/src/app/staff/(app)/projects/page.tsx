"use client";
import * as React from "react";
import Link from "next/link";
import { LayoutGrid, List, Plus, Search, Settings } from "lucide-react";
import { api, extractApiError } from "@/lib/portal/api";
import { formatDate } from "@/lib/portal/format";
import {
  PRIORITIES,
  PRIORITY_LABELS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  type Client,
  type Priority,
  type Project,
  type ProjectStatus,
  type User,
} from "@/lib/portal/types";
import { Button, IconButton } from "@/components/portal/button";
import { Field, Input, Select, Textarea } from "@/components/portal/form";
import { Modal } from "@/components/portal/modal";
import { useToast } from "@/components/portal/toast";
import { isAdminRole, usePortalUser } from "@/components/portal/user-context";
import {
  AvatarStack,
  EmptyState,
  PriorityBadge,
  ProgressBar,
  Skeleton,
  StatusBadge,
} from "@/components/portal/ui";

function asList<T>(data: T[] | { results: T[] }): T[] {
  return Array.isArray(data) ? data : data.results ?? [];
}

export default function ProjectsPage() {
  const { user } = usePortalUser();
  const admin = isAdminRole(user);
  const toast = useToast();

  const [projects, setProjects] = React.useState<Project[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<"" | ProjectStatus>("");
  const [priority, setPriority] = React.useState<"" | Priority>("");
  const [view, setView] = React.useState<"grid" | "list">("grid");
  const [createOpen, setCreateOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Project[] | { results: Project[] }>("projects/my-projects", {
        search,
        status,
        priority,
      });
      setProjects(asList(data));
    } catch (e) {
      toast(extractApiError((e as { body?: unknown }).body, "Failed to load projects."), "danger");
    } finally {
      setLoading(false);
    }
  }, [search, status, priority, toast]);

  React.useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="portal-fade-in">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="portal-page-title">Projects</h1>
          <p className="portal-page-subtitle">Track delivery across all your work.</p>
        </div>
        {admin && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New Project
          </Button>
        )}
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="portal-text-muted pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
          <Input className="pl-8" placeholder="Search projects…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus | "")} className="w-auto">
          <option value="">All Statuses</option>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>{PROJECT_STATUS_LABELS[s]}</option>
          ))}
        </Select>
        <Select value={priority} onChange={(e) => setPriority(e.target.value as Priority | "")} className="w-auto">
          <option value="">All Priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
          ))}
        </Select>
        <span className="portal-text-muted ml-auto text-[0.72rem]">{projects.length} projects</span>
        <div className="flex gap-1">
          <IconButton tone={view === "grid" ? "primary" : "default"} onClick={() => setView("grid")} aria-label="Grid view">
            <LayoutGrid className="h-4 w-4" />
          </IconButton>
          <IconButton tone={view === "list" ? "primary" : "default"} onClick={() => setView("list")} aria-label="List view">
            <List className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : projects.length === 0 ? (
        <div className="portal-card">
          <EmptyState icon={<LayoutGrid className="h-8 w-8" />} message="No projects match your filters." />
        </div>
      ) : view === "grid" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => <ProjectCard key={p.id} project={p} admin={admin} />)}
        </div>
      ) : (
        <ProjectTable projects={projects} admin={admin} />
      )}

      {createOpen && (
        <CreateProjectModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            toast("Project created.", "success");
            load();
          }}
        />
      )}
    </div>
  );
}

function ProjectCard({ project, admin }: { project: Project; admin: boolean }) {
  const pct = project.progress_percent ?? 0;
  const names = (project.co_assignments ?? []).map((c) => c.user_name).concat(project.assigned_to_name ? [project.assigned_to_name] : []);
  return (
    <Link href={`/staff/projects/${project.id}`} className={`portal-project-card pl-${project.priority}`}>
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <StatusBadge status={project.status} />
          <PriorityBadge priority={project.priority} />
        </div>
        {admin && (
          <span
            className="portal-icon-btn"
            onClick={(e) => {
              e.preventDefault();
              window.location.href = `/staff/projects/${project.id}/settings`;
            }}
          >
            <Settings className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      <h3 className="text-[0.88rem] font-bold leading-tight">{project.name}</h3>
      <p className="portal-text-muted mt-0.5 text-[0.68rem]">{project.client_name || "No client"}</p>
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-[0.65rem]">
          <span className="portal-text-muted">Progress</span>
          <span>{pct}%</span>
        </div>
        <ProgressBar percent={pct} />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <AvatarStack names={names} />
        <span className="portal-text-muted text-[0.65rem]">{formatDate(project.end_date)}</span>
      </div>
    </Link>
  );
}

function ProjectTable({ projects, admin }: { projects: Project[]; admin: boolean }) {
  return (
    <div className="portal-card overflow-x-auto">
      <table className="portal-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Client</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Progress</th>
            <th>Due</th>
            {admin && <th></th>}
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id}>
              <td>
                <Link href={`/staff/projects/${p.id}`} className="font-semibold">{p.name}</Link>
              </td>
              <td className="portal-text-muted">{p.client_name || "—"}</td>
              <td><StatusBadge status={p.status} /></td>
              <td><PriorityBadge priority={p.priority} /></td>
              <td className="min-w-[120px]"><ProgressBar percent={p.progress_percent ?? 0} /></td>
              <td className="portal-text-muted whitespace-nowrap">{formatDate(p.end_date)}</td>
              {admin && (
                <td>
                  <Link href={`/staff/projects/${p.id}/settings`} className="portal-icon-btn inline-flex">
                    <Settings className="h-3.5 w-3.5" />
                  </Link>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CreateProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [clients, setClients] = React.useState<Client[]>([]);
  const [users, setUsers] = React.useState<User[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({
    name: "",
    client: "",
    assigned_to: "",
    status: "active" as ProjectStatus,
    priority: "medium" as Priority,
    start_date: "",
    end_date: "",
    description: "",
  });

  React.useEffect(() => {
    (async () => {
      try {
        const [c, u] = await Promise.all([
          api.get<Client[] | { results: Client[] }>("projects/clients"),
          api.get<User[] | { results: User[] }>("auth/users"),
        ]);
        setClients(asList(c));
        setUsers(asList(u));
      } catch {
        /* ignore */
      }
    })();
  }, []);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.start_date || !form.end_date) {
      toast("Name, start and end dates are required.", "warning");
      return;
    }
    setSaving(true);
    try {
      await api.post("projects/projects", {
        name: form.name,
        status: form.status,
        priority: form.priority,
        start_date: form.start_date,
        end_date: form.end_date,
        description: form.description,
        client: form.client ? Number(form.client) : null,
        assigned_to: form.assigned_to ? Number(form.assigned_to) : null,
      });
      onCreated();
    } catch (err) {
      toast(extractApiError((err as { body?: unknown }).body, "Failed to create project."), "danger");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New Project"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button form="new-project-form" type="submit" loading={saving}>Create</Button>
        </>
      }
    >
      <form id="new-project-form" onSubmit={submit}>
        <Field label="Project name">
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus />
        </Field>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label="Client">
            <Select value={form.client} onChange={(e) => set("client", e.target.value)}>
              <option value="">— None —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Assignee">
            <Select value={form.assigned_to} onChange={(e) => set("assigned_to", e.target.value)}>
              <option value="">— Unassigned —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => set("status", e.target.value as ProjectStatus)}>
              {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABELS[s]}</option>)}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
            </Select>
          </Field>
          <Field label="Start date">
            <Input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} />
          </Field>
          <Field label="End date">
            <Input type="date" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} />
          </Field>
        </div>
        <Field label="Description">
          <Textarea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
