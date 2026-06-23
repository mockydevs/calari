"use client";
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Activity,
  Calendar,
  CheckCircle2,
  Download,
  FileText,
  Flag,
  Kanban,
  Plus,
  Settings,
  ShieldAlert,
  Trash2,
  Users,
} from "lucide-react";
import { api, extractApiError } from "@/lib/portal/api";
import { formatDate, timeAgo } from "@/lib/portal/format";
import type {
  Project,
  ProjectActivity,
  ProjectBlocker,
  ProjectContactPerson,
  ProjectCoAssignment,
  ProjectFile,
  ProjectMilestone,
  ProjectProgress,
  User,
} from "@/lib/portal/types";
import { CO_ASSIGN_ROLES } from "@/lib/portal/types";
import { Button, IconButton } from "@/components/portal/button";
import { Field, Input, Select, Textarea } from "@/components/portal/form";
import { Modal } from "@/components/portal/modal";
import { useToast } from "@/components/portal/toast";
import { isAdminRole, usePortalUser } from "@/components/portal/user-context";
import {
  Avatar,
  Card,
  EmptyState,
  PriorityBadge,
  ProgressBar,
  SectionTitle,
  Skeleton,
  StatCard,
  StatusBadge,
} from "@/components/portal/ui";

type Tab = "overview" | "tasks" | "files" | "team" | "activity";
const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "overview", label: "Overview", icon: FileText },
  { key: "tasks", label: "Tasks", icon: Kanban },
  { key: "files", label: "Files", icon: FileText },
  { key: "team", label: "Team", icon: Users },
  { key: "activity", label: "Activity", icon: Activity },
];

function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = usePortalUser();
  const admin = isAdminRole(user);
  const toast = useToast();

  const [project, setProject] = React.useState<Project | null>(null);
  const [progress, setProgress] = React.useState<ProjectProgress | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [tab, setTab] = React.useState<Tab>("overview");

  const load = React.useCallback(async () => {
    try {
      const [p, prog] = await Promise.all([
        api.get<Project>(`projects/projects/${id}`),
        api.get<ProjectProgress>(`projects/projects/${id}/progress`).catch(() => null),
      ]);
      setProject(p);
      setProgress(prog);
    } catch (e) {
      toast(extractApiError((e as { body?: unknown }).body, "Failed to load project."), "danger");
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Skeleton className="h-64" />;
  if (!project) return <Card><EmptyState message="Project not found." /></Card>;

  return (
    <div className="portal-fade-in">
      {/* Hero */}
      <div className="portal-card mb-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-1.5 flex items-center gap-1.5">
              <StatusBadge status={project.status} />
              <PriorityBadge priority={project.priority} />
            </div>
            <h1 className="portal-page-title">{project.name}</h1>
            <p className="portal-text-muted mt-0.5 text-[0.75rem]">{project.client_name || "No client"}</p>
            <div className="portal-text-muted mt-2 flex items-center gap-3 text-[0.7rem]">
              <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {formatDate(project.start_date)} → {formatDate(project.end_date)}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href={`/staff/projects/${id}/tasks`}><Button variant="secondary"><Kanban className="h-4 w-4" /> Task Board</Button></Link>
            {admin && <Link href={`/staff/projects/${id}/settings`}><Button variant="secondary"><Settings className="h-4 w-4" /> Settings</Button></Link>}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="portal-tabs mb-4">
        {TABS.map((t) => (
          <button key={t.key} className={`portal-tab ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab project={project} progress={progress} canEdit={admin} reload={load} />}
      {tab === "tasks" && <TasksTab project={project} />}
      {tab === "files" && <FilesTab projectId={id} canEdit={admin} />}
      {tab === "team" && <TeamTab projectId={id} canEdit={admin} />}
      {tab === "activity" && <ActivityTab projectId={id} />}
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────
function OverviewTab({
  project,
  progress,
  canEdit,
  reload,
}: {
  project: Project;
  progress: ProjectProgress | null;
  canEdit: boolean;
  reload: () => void;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        <Card>
          <SectionTitle icon={<FileText className="h-3.5 w-3.5" />}>Description</SectionTitle>
          <p className="text-[0.82rem] leading-relaxed">{project.description || <span className="portal-text-muted">No description.</span>}</p>
        </Card>
        <MilestonesPanel projectId={project.id} canEdit={canEdit} onChange={reload} />
        <ContactsPanel projectId={project.id} canEdit={canEdit} />
      </div>
      <div className="space-y-3">
        <Card>
          <SectionTitle icon={<CheckCircle2 className="h-3.5 w-3.5" />}>Progress</SectionTitle>
          <div className="mb-1 flex justify-between text-[0.7rem]"><span className="portal-text-muted">Tasks complete</span><span>{progress?.percent ?? project.progress_percent ?? 0}%</span></div>
          <ProgressBar percent={progress?.percent ?? project.progress_percent ?? 0} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <StatCard icon={<Kanban className="h-4 w-4" />} value={progress?.total ?? project.tasks?.length ?? 0} label="Total Tasks" />
            <StatCard icon={<CheckCircle2 className="h-4 w-4" />} value={progress?.done ?? 0} label="Done" accent="var(--accent-green)" />
          </div>
        </Card>
        <BlockersPanel projectId={project.id} canEdit={canEdit} onChange={reload} />
      </div>
    </div>
  );
}

// ── Milestones ────────────────────────────────────────────────────────────────
function MilestonesPanel({ projectId, canEdit, onChange }: { projectId: number; canEdit: boolean; onChange: () => void }) {
  const toast = useToast();
  const [items, setItems] = React.useState<ProjectMilestone[]>([]);
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", due_date: "", description: "" });
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setItems(asList(await api.get<ProjectMilestone[] | { results: ProjectMilestone[] }>("projects/project-milestones", { project: projectId })));
    } catch { /* ignore */ }
  }, [projectId]);
  React.useEffect(() => { void load(); }, [load]);

  async function toggle(m: ProjectMilestone) {
    try {
      await api.patch(`projects/project-milestones/${m.id}`, { completed: !m.completed });
      load(); onChange();
    } catch (e) { toast(extractApiError((e as { body?: unknown }).body), "danger"); }
  }
  async function remove(m: ProjectMilestone) {
    if (!confirm("Delete this milestone?")) return;
    try { await api.del(`projects/project-milestones/${m.id}`); load(); } catch (e) { toast(extractApiError((e as { body?: unknown }).body), "danger"); }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.due_date) return toast("Name and due date are required.", "warning");
    setSaving(true);
    try {
      await api.post("projects/project-milestones", { project: projectId, ...form });
      setOpen(false); setForm({ name: "", due_date: "", description: "" }); load(); onChange();
      toast("Milestone added.", "success");
    } catch (e) { toast(extractApiError((e as { body?: unknown }).body), "danger"); } finally { setSaving(false); }
  }

  return (
    <Card>
      <SectionTitle icon={<Flag className="h-3.5 w-3.5" />} action={canEdit && <IconButton tone="primary" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /></IconButton>}>Milestones</SectionTitle>
      {items.length === 0 ? <EmptyState message="No milestones yet." /> : (
        <div className="flex flex-col">
          {items.map((m) => (
            <div key={m.id} className="flex items-center gap-2 border-b py-2 last:border-0" style={{ borderColor: "var(--border)" }}>
              <button onClick={() => canEdit && toggle(m)} className="shrink-0" aria-label="Toggle complete">
                <CheckCircle2 className="h-4 w-4" style={{ color: m.completed ? "var(--accent-green)" : "var(--text-muted)" }} />
              </button>
              <div className="min-w-0 flex-1">
                <div className={`text-[0.78rem] ${m.completed ? "line-through opacity-60" : ""}`}>{m.name}</div>
                <div className="portal-text-muted text-[0.65rem]">{formatDate(m.due_date)}</div>
              </div>
              {canEdit && <IconButton tone="danger" onClick={() => remove(m)}><Trash2 className="h-3.5 w-3.5" /></IconButton>}
            </div>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Add Milestone" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button form="ms-form" type="submit" loading={saving}>Add</Button></>}>
        <form id="ms-form" onSubmit={create}>
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus /></Field>
          <Field label="Due date"><Input type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} /></Field>
          <Field label="Description"><Textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></Field>
        </form>
      </Modal>
    </Card>
  );
}

// ── Contacts ──────────────────────────────────────────────────────────────────
function ContactsPanel({ projectId, canEdit }: { projectId: number; canEdit: boolean }) {
  const toast = useToast();
  const [items, setItems] = React.useState<ProjectContactPerson[]>([]);
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", email: "", phone_number: "", role: "" });
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    try { setItems(asList(await api.get<ProjectContactPerson[] | { results: ProjectContactPerson[] }>("projects/project-contacts", { project: projectId }))); } catch { /* ignore */ }
  }, [projectId]);
  React.useEffect(() => { void load(); }, [load]);

  async function remove(c: ProjectContactPerson) {
    if (!confirm("Remove contact?")) return;
    try { await api.del(`projects/project-contacts/${c.id}`); load(); } catch (e) { toast(extractApiError((e as { body?: unknown }).body), "danger"); }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.email) return toast("Name and email required.", "warning");
    setSaving(true);
    try {
      await api.post("projects/project-contacts", { project: projectId, ...form });
      setOpen(false); setForm({ name: "", email: "", phone_number: "", role: "" }); load(); toast("Contact added.", "success");
    } catch (e) { toast(extractApiError((e as { body?: unknown }).body), "danger"); } finally { setSaving(false); }
  }

  return (
    <Card>
      <SectionTitle icon={<Users className="h-3.5 w-3.5" />} action={canEdit && <IconButton tone="primary" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /></IconButton>}>Contact Persons</SectionTitle>
      {items.length === 0 ? <EmptyState message="No contacts." /> : (
        <div className="flex flex-col">
          {items.map((c) => (
            <div key={c.id} className="flex items-center gap-2 border-b py-2 last:border-0" style={{ borderColor: "var(--border)" }}>
              <Avatar name={c.name} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="text-[0.78rem] font-medium">{c.name} {c.role && <span className="portal-text-muted">· {c.role}</span>}</div>
                <div className="portal-text-muted text-[0.65rem]">{c.email}{c.phone_number ? ` · ${c.phone_number}` : ""}</div>
              </div>
              {canEdit && <IconButton tone="danger" onClick={() => remove(c)}><Trash2 className="h-3.5 w-3.5" /></IconButton>}
            </div>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Add Contact" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button form="ct-form" type="submit" loading={saving}>Add</Button></>}>
        <form id="ct-form" onSubmit={create}>
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></Field>
          <Field label="Phone"><Input value={form.phone_number} onChange={(e) => setForm((f) => ({ ...f, phone_number: e.target.value }))} /></Field>
          <Field label="Role"><Input value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} placeholder="e.g. Project Sponsor" /></Field>
        </form>
      </Modal>
    </Card>
  );
}

// ── Blockers ──────────────────────────────────────────────────────────────────
function BlockersPanel({ projectId, canEdit, onChange }: { projectId: number; canEdit: boolean; onChange: () => void }) {
  const toast = useToast();
  const [items, setItems] = React.useState<ProjectBlocker[]>([]);
  const [open, setOpen] = React.useState(false);
  const [desc, setDesc] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    try { setItems(asList(await api.get<ProjectBlocker[] | { results: ProjectBlocker[] }>("projects/project-blockers", { project: projectId, resolved: false }))); } catch { /* ignore */ }
  }, [projectId]);
  React.useEffect(() => { void load(); }, [load]);

  async function resolve(b: ProjectBlocker) {
    try { await api.patch(`projects/project-blockers/${b.id}`, { resolved: true }); load(); onChange(); toast("Blocker resolved.", "success"); } catch (e) { toast(extractApiError((e as { body?: unknown }).body), "danger"); }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!desc) return;
    setSaving(true);
    try { await api.post("projects/project-blockers", { project: projectId, description: desc }); setOpen(false); setDesc(""); load(); onChange(); toast("Blocker reported.", "success"); } catch (e) { toast(extractApiError((e as { body?: unknown }).body), "danger"); } finally { setSaving(false); }
  }

  return (
    <Card>
      <SectionTitle icon={<ShieldAlert className="h-3.5 w-3.5" />} action={canEdit && <IconButton tone="danger" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /></IconButton>}>Blockers</SectionTitle>
      {items.length === 0 ? <EmptyState message="No active blockers." /> : (
        <div className="flex flex-col gap-2">
          {items.map((b) => (
            <div key={b.id} className="rounded-md p-2.5 text-[0.76rem]" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
              <div className="flex items-start justify-between gap-2">
                <span>{b.description}</span>
                {canEdit && <button onClick={() => resolve(b)} className="shrink-0 text-[0.65rem]" style={{ color: "var(--accent-green)" }}>Resolve</button>}
              </div>
              <div className="portal-text-muted mt-1 text-[0.62rem]">{b.reported_by_name} · {timeAgo(b.created_at)}</div>
            </div>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Report Blocker" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button form="bl-form" type="submit" loading={saving} variant="danger">Report</Button></>}>
        <form id="bl-form" onSubmit={create}>
          <Field label="What's blocking progress?"><Textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} autoFocus /></Field>
        </form>
      </Modal>
    </Card>
  );
}

// ── Tasks summary tab ─────────────────────────────────────────────────────────
function TasksTab({ project }: { project: Project }) {
  const counts = React.useMemo(() => {
    const c = { todo: 0, in_progress: 0, in_review: 0, done: 0 };
    (project.tasks ?? []).forEach((t) => { c[t.status] = (c[t.status] ?? 0) + 1; });
    return c;
  }, [project.tasks]);
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <SectionTitle icon={<Kanban className="h-3.5 w-3.5" />}>Task Board</SectionTitle>
        <Link href={`/staff/projects/${project.id}/tasks`}><Button><Kanban className="h-4 w-4" /> Open Task Board</Button></Link>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatCard icon={<Kanban className="h-4 w-4" />} value={counts.todo} label="To Do" />
        <StatCard icon={<Kanban className="h-4 w-4" />} value={counts.in_progress} label="In Progress" accent="var(--accent-amber)" />
        <StatCard icon={<Kanban className="h-4 w-4" />} value={counts.in_review} label="In Review" accent="var(--accent-violet)" />
        <StatCard icon={<CheckCircle2 className="h-4 w-4" />} value={counts.done} label="Done" accent="var(--accent-green)" />
      </div>
    </Card>
  );
}

// ── Files ─────────────────────────────────────────────────────────────────────
function FilesTab({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const toast = useToast();
  const [items, setItems] = React.useState<ProjectFile[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(async () => {
    try { setItems(asList(await api.get<ProjectFile[] | { results: ProjectFile[] }>("projects/project-files", { project: projectId }))); } catch { /* ignore */ }
  }, [projectId]);
  React.useEffect(() => { void load(); }, [load]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("project", projectId);
      fd.append("file_name", file.name);
      fd.append("file", file);
      await api.upload("projects/project-files", fd);
      load(); toast("File uploaded.", "success");
    } catch (e) { toast(extractApiError((e as { body?: unknown }).body, "Upload failed."), "danger"); } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  }
  async function remove(f: ProjectFile) {
    if (!confirm("Delete file?")) return;
    try { await api.del(`projects/project-files/${f.id}`); load(); } catch (e) { toast(extractApiError((e as { body?: unknown }).body), "danger"); }
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle icon={<FileText className="h-3.5 w-3.5" />}>Files</SectionTitle>
        {canEdit && (
          <>
            <input ref={fileRef} type="file" hidden onChange={onUpload} />
            <Button loading={uploading} onClick={() => fileRef.current?.click()}><Plus className="h-4 w-4" /> Upload</Button>
          </>
        )}
      </div>
      {items.length === 0 ? <EmptyState icon={<FileText className="h-8 w-8" />} message="No files uploaded." /> : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((f) => (
            <div key={f.id} className="flex items-center gap-2 rounded-md p-2.5" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
              <FileText className="h-5 w-5 shrink-0" style={{ color: "var(--accent-primary)" }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[0.76rem] font-medium">{f.file_name}</div>
                <div className="portal-text-muted text-[0.62rem]">{f.uploaded_by_name} · {formatDate(f.uploaded_at)}</div>
              </div>
              <a href={f.file} target="_blank" rel="noreferrer" className="portal-icon-btn"><Download className="h-3.5 w-3.5" /></a>
              {canEdit && <IconButton tone="danger" onClick={() => remove(f)}><Trash2 className="h-3.5 w-3.5" /></IconButton>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Team ──────────────────────────────────────────────────────────────────────
function TeamTab({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const toast = useToast();
  const [items, setItems] = React.useState<ProjectCoAssignment[]>([]);
  const [users, setUsers] = React.useState<User[]>([]);
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ user: "", role: "developer" });
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    try { setItems(asList(await api.get<ProjectCoAssignment[] | { results: ProjectCoAssignment[] }>("projects/project-co-assign", { project: projectId }))); } catch { /* ignore */ }
  }, [projectId]);
  React.useEffect(() => { void load(); }, [load]);
  React.useEffect(() => { if (open && users.length === 0) api.get<User[] | { results: User[] }>("auth/users").then((u) => setUsers(asList(u))).catch(() => {}); }, [open, users.length]);

  async function remove(c: ProjectCoAssignment) {
    if (!confirm("Remove team member?")) return;
    try { await api.del(`projects/project-co-assign/${c.id}`); load(); } catch (e) { toast(extractApiError((e as { body?: unknown }).body), "danger"); }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.user) return toast("Select a user.", "warning");
    setSaving(true);
    try { await api.post("projects/project-co-assign", { project: Number(projectId), user: Number(form.user), role: form.role }); setOpen(false); setForm({ user: "", role: "developer" }); load(); toast("Member added.", "success"); } catch (e) { toast(extractApiError((e as { body?: unknown }).body), "danger"); } finally { setSaving(false); }
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle icon={<Users className="h-3.5 w-3.5" />}>Team</SectionTitle>
        {canEdit && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add Member</Button>}
      </div>
      {items.length === 0 ? <EmptyState icon={<Users className="h-8 w-8" />} message="No team members assigned." /> : (
        <div className="flex flex-col">
          {items.map((c) => (
            <div key={c.id} className="flex items-center gap-2.5 border-b py-2.5 last:border-0" style={{ borderColor: "var(--border)" }}>
              <Avatar name={c.user_name} size="md" />
              <div className="min-w-0 flex-1">
                <div className="text-[0.78rem] font-medium">{c.user_name}</div>
                <div className="portal-text-muted text-[0.65rem] capitalize">{c.role}</div>
              </div>
              {canEdit && <IconButton tone="danger" onClick={() => remove(c)}><Trash2 className="h-3.5 w-3.5" /></IconButton>}
            </div>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Add Team Member" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button form="tm-form" type="submit" loading={saving}>Add</Button></>}>
        <form id="tm-form" onSubmit={create}>
          <Field label="User"><Select value={form.user} onChange={(e) => setForm((f) => ({ ...f, user: e.target.value }))}><option value="">— Select —</option>{users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}</Select></Field>
          <Field label="Role"><Select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>{CO_ASSIGN_ROLES.map((r) => <option key={r} value={r} className="capitalize">{r}</option>)}</Select></Field>
        </form>
      </Modal>
    </Card>
  );
}

// ── Activity ──────────────────────────────────────────────────────────────────
function ActivityTab({ projectId }: { projectId: string }) {
  const [items, setItems] = React.useState<ProjectActivity[]>([]);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    api.get<ProjectActivity[] | { results: ProjectActivity[] }>("projects/project-activity", { project: projectId })
      .then((d) => setItems(asList(d))).catch(() => {}).finally(() => setLoading(false));
  }, [projectId]);

  return (
    <Card>
      <SectionTitle icon={<Activity className="h-3.5 w-3.5" />}>Activity Log</SectionTitle>
      {loading ? <Skeleton className="h-24" /> : items.length === 0 ? <EmptyState message="No activity yet." /> : (
        <div className="flex flex-col gap-3">
          {items.map((a) => (
            <div key={a.id} className="flex items-start gap-2.5">
              <Avatar name={a.user_name} size="sm" />
              <div className="min-w-0">
                <div className="text-[0.76rem]"><span className="font-medium">{a.user_name || "Someone"}</span> <span className="portal-text-muted">{a.action}</span> {a.detail && <span className="portal-text-muted">— {a.detail}</span>}</div>
                <div className="portal-text-muted text-[0.63rem]">{timeAgo(a.created_at)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
