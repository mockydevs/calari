"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Ban, CheckCircle2, Pencil, Plus, RotateCcw, Search, Trash2, Building2, Users as UsersIcon, FolderKanban } from "lucide-react";
import { api, extractApiError } from "@/lib/portal/api";
import { formatDate } from "@/lib/portal/format";
import {
  USER_ROLE_LABELS,
  type Client,
  type Project,
  type User,
  type UserRole,
} from "@/lib/portal/types";
import { Button, IconButton } from "@/components/portal/button";
import { Field, Input, Select } from "@/components/portal/form";
import { Modal } from "@/components/portal/modal";
import { useToast } from "@/components/portal/toast";
import { Badge, Card, EmptyState, PriorityBadge, RoleBadge, Skeleton, StatusBadge } from "@/components/portal/ui";

function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

type Tab = "users" | "clients" | "projects";

export default function SettingsPage() {
  return (
    <React.Suspense fallback={<Skeleton className="h-64" />}>
      <SettingsInner />
    </React.Suspense>
  );
}

function SettingsInner() {
  const params = useSearchParams();
  const initial = (params.get("tab") as Tab) || "users";
  const [tab, setTab] = React.useState<Tab>(["users", "clients", "projects"].includes(initial) ? initial : "users");

  return (
    <div className="portal-fade-in">
      <div className="mb-4">
        <h1 className="portal-page-title">Settings</h1>
        <p className="portal-page-subtitle">Manage portal users, clients and projects.</p>
      </div>
      <div className="portal-tabs mb-4">
        <button className={`portal-tab ${tab === "users" ? "active" : ""}`} onClick={() => setTab("users")}><UsersIcon className="h-3.5 w-3.5" /> Users</button>
        <button className={`portal-tab ${tab === "clients" ? "active" : ""}`} onClick={() => setTab("clients")}><Building2 className="h-3.5 w-3.5" /> Clients</button>
        <button className={`portal-tab ${tab === "projects" ? "active" : ""}`} onClick={() => setTab("projects")}><FolderKanban className="h-3.5 w-3.5" /> Projects</button>
      </div>
      {tab === "users" && <UsersTab />}
      {tab === "clients" && <ClientsTab />}
      {tab === "projects" && <ProjectsTab />}
    </div>
  );
}

// ── Users ─────────────────────────────────────────────────────────────────────
function UsersTab() {
  const toast = useToast();
  const [users, setUsers] = React.useState<User[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [role, setRole] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("");
  const [editing, setEditing] = React.useState<User | null>(null);
  const [creating, setCreating] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try { setUsers(asList(await api.get<User[] | { results: User[] }>("auth/users"))); }
    catch (e) { toast(extractApiError((e as { body?: unknown }).body), "danger"); }
    finally { setLoading(false); }
  }, [toast]);
  React.useEffect(() => { void load(); }, [load]);

  const filtered = users.filter((u) => {
    if (search && !`${u.full_name} ${u.username} ${u.email}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (role && u.role !== role) return false;
    if (statusFilter === "active" && !u.is_active) return false;
    if (statusFilter === "inactive" && u.is_active) return false;
    return true;
  });

  async function toggleActive(u: User) {
    try {
      await api.post(`auth/users/${u.id}/${u.is_active ? "deactivate" : "activate"}`);
      toast(`User ${u.is_active ? "deactivated" : "activated"}.`, "success"); load();
    } catch (e) { toast(extractApiError((e as { body?: unknown }).body), "danger"); }
  }
  async function remove(u: User) {
    if (!confirm(`Remove ${u.full_name || u.username}?`)) return;
    try { await api.del(`auth/users/${u.id}/delete`); toast("User removed.", "success"); load(); }
    catch (e) { toast(extractApiError((e as { body?: unknown }).body), "danger"); }
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-[0.8rem] font-bold">All Users <span className="portal-text-muted">({filtered.length})</span></h3>
        <Button className="ml-auto" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Add User</Button>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-[160px] flex-1">
          <Search className="portal-text-muted pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
          <Input className="pl-8" placeholder="Search users…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={role} onChange={(e) => setRole(e.target.value)} className="w-auto">
          <option value="">All Roles</option>
          {(Object.keys(USER_ROLE_LABELS) as UserRole[]).map((r) => <option key={r} value={r}>{USER_ROLE_LABELS[r]}</option>)}
        </Select>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-auto">
          <option value="">All Statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
        </Select>
        <IconButton onClick={load} aria-label="Refresh"><RotateCcw className="h-4 w-4" /></IconButton>
      </div>
      {loading ? <Skeleton className="h-40" /> : filtered.length === 0 ? <EmptyState message="No users found." /> : (
        <div className="overflow-x-auto">
          <table className="portal-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Job Title</th><th>Status</th><th>Last Login</th><th></th></tr></thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td className="font-semibold">{u.full_name || u.username}</td>
                  <td className="portal-text-muted">{u.email}</td>
                  <td><RoleBadge role={u.role} /></td>
                  <td className="portal-text-muted">{u.job_title || "—"}</td>
                  <td><Badge tone={u.is_active ? "active" : "inactive"}>{u.is_active ? "Active" : "Inactive"}</Badge></td>
                  <td className="portal-text-muted whitespace-nowrap">{u.last_login ? formatDate(u.last_login) : "Never"}</td>
                  <td>
                    <div className="flex gap-1">
                      <IconButton tone="primary" onClick={() => setEditing(u)} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></IconButton>
                      <IconButton onClick={() => toggleActive(u)} aria-label="Toggle active">{u.is_active ? <Ban className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}</IconButton>
                      <IconButton tone="danger" onClick={() => remove(u)} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <UserModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {editing && <UserModal user={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </Card>
  );
}

function UserModal({ user, onClose, onSaved }: { user?: User; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const editing = !!user;
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({
    full_name: user?.full_name ?? "",
    username: user?.username ?? "",
    email: user?.email ?? "",
    password: "",
    role: (user?.role ?? "employee") as UserRole,
    job_title: user?.job_title ?? "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`auth/users/${user!.id}`, { full_name: form.full_name, email: form.email, role: form.role, job_title: form.job_title });
        toast("User updated.", "success");
      } else {
        await api.post("auth/register", { full_name: form.full_name, username: form.username, email: form.email, password: form.password, role: form.role, job_title: form.job_title });
        toast("User created.", "success");
      }
      onSaved();
    } catch (e) { toast(extractApiError((e as { body?: unknown }).body, "Save failed."), "danger"); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={editing ? "Edit User" : "Add User"} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button form="user-form" type="submit" loading={saving}>{editing ? "Save" : "Create"}</Button></>}>
      <form id="user-form" onSubmit={submit}>
        <Field label="Full name"><Input value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} autoFocus /></Field>
        {!editing && <Field label="Username"><Input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} /></Field>}
        <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></Field>
        {!editing && <Field label="Password"><Input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} /></Field>}
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label="Role"><Select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}>{(Object.keys(USER_ROLE_LABELS) as UserRole[]).map((r) => <option key={r} value={r}>{USER_ROLE_LABELS[r]}</option>)}</Select></Field>
          <Field label="Job title"><Input value={form.job_title} onChange={(e) => setForm((f) => ({ ...f, job_title: e.target.value }))} /></Field>
        </div>
      </form>
    </Modal>
  );
}

// ── Clients ───────────────────────────────────────────────────────────────────
function ClientsTab() {
  const toast = useToast();
  const [clients, setClients] = React.useState<Client[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [editing, setEditing] = React.useState<Client | null>(null);
  const [creating, setCreating] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try { setClients(asList(await api.get<Client[] | { results: Client[] }>("projects/clients"))); }
    catch (e) { toast(extractApiError((e as { body?: unknown }).body), "danger"); } finally { setLoading(false); }
  }, [toast]);
  React.useEffect(() => { void load(); }, [load]);

  const filtered = clients.filter((c) => !search || `${c.name} ${c.company_name} ${c.email}`.toLowerCase().includes(search.toLowerCase()));

  async function remove(c: Client) {
    if (!confirm(`Delete ${c.name}?`)) return;
    try { await api.del(`projects/clients/${c.id}`); toast("Client deleted.", "success"); load(); }
    catch (e) { toast(extractApiError((e as { body?: unknown }).body), "danger"); }
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-[0.8rem] font-bold">All Clients <span className="portal-text-muted">({filtered.length})</span></h3>
        <Button className="ml-auto" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Add Client</Button>
      </div>
      <div className="relative mb-3 min-w-[160px]">
        <Search className="portal-text-muted pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
        <Input className="pl-8" placeholder="Search clients…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {loading ? <Skeleton className="h-40" /> : filtered.length === 0 ? <EmptyState message="No clients." /> : (
        <div className="overflow-x-auto">
          <table className="portal-table">
            <thead><tr><th>Name</th><th>Company</th><th>Email</th><th>Phone</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td className="font-semibold">{c.name}</td>
                  <td className="portal-text-muted">{c.company_name || "—"}</td>
                  <td className="portal-text-muted">{c.email}</td>
                  <td className="portal-text-muted">{c.phone_number || "—"}</td>
                  <td><Badge tone={c.is_active ? "active" : "inactive"}>{c.is_active ? "Active" : "Inactive"}</Badge></td>
                  <td>
                    <div className="flex gap-1">
                      <IconButton tone="primary" onClick={() => setEditing(c)}><Pencil className="h-3.5 w-3.5" /></IconButton>
                      <IconButton tone="danger" onClick={() => remove(c)}><Trash2 className="h-3.5 w-3.5" /></IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <ClientModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {editing && <ClientModal client={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </Card>
  );
}

function ClientModal({ client, onClose, onSaved }: { client?: Client; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const editing = !!client;
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({
    name: client?.name ?? "",
    company_name: client?.company_name ?? "",
    email: client?.email ?? "",
    phone_number: client?.phone_number ?? "",
    is_active: client?.is_active ?? true,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) await api.patch(`projects/clients/${client!.id}`, form);
      else await api.post("projects/clients", form);
      toast(editing ? "Client updated." : "Client created.", "success");
      onSaved();
    } catch (e) { toast(extractApiError((e as { body?: unknown }).body, "Save failed."), "danger"); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={editing ? "Edit Client" : "Add Client"} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button form="client-form" type="submit" loading={saving}>{editing ? "Save" : "Create"}</Button></>}>
      <form id="client-form" onSubmit={submit}>
        <Field label="Name"><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus /></Field>
        <Field label="Company"><Input value={form.company_name} onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))} /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></Field>
        <Field label="Phone"><Input value={form.phone_number} onChange={(e) => setForm((f) => ({ ...f, phone_number: e.target.value }))} /></Field>
        <label className="flex items-center gap-2 text-[0.78rem]"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} /> Active</label>
      </form>
    </Modal>
  );
}

// ── Projects ──────────────────────────────────────────────────────────────────
function ProjectsTab() {
  const toast = useToast();
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    try { setProjects(asList(await api.get<Project[] | { results: Project[] }>("projects/projects"))); }
    catch (e) { toast(extractApiError((e as { body?: unknown }).body), "danger"); } finally { setLoading(false); }
  }, [toast]);
  React.useEffect(() => { void load(); }, [load]);

  const filtered = projects.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()));

  async function remove(p: Project) {
    if (!confirm(`Delete project "${p.name}"? This cannot be undone.`)) return;
    try { await api.del(`projects/projects/${p.id}`); toast("Project deleted.", "success"); load(); }
    catch (e) { toast(extractApiError((e as { body?: unknown }).body), "danger"); }
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-[0.8rem] font-bold">All Projects <span className="portal-text-muted">({filtered.length})</span></h3>
      </div>
      <div className="relative mb-3">
        <Search className="portal-text-muted pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
        <Input className="pl-8" placeholder="Search projects…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {loading ? <Skeleton className="h-40" /> : filtered.length === 0 ? <EmptyState message="No projects." /> : (
        <div className="overflow-x-auto">
          <table className="portal-table">
            <thead><tr><th>Project</th><th>Client</th><th>Status</th><th>Priority</th><th>Due</th><th></th></tr></thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td className="font-semibold">{p.name}</td>
                  <td className="portal-text-muted">{p.client_name || "—"}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td><PriorityBadge priority={p.priority} /></td>
                  <td className="portal-text-muted whitespace-nowrap">{formatDate(p.end_date)}</td>
                  <td><IconButton tone="danger" onClick={() => remove(p)}><Trash2 className="h-3.5 w-3.5" /></IconButton></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
