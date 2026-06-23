import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Bot, FileText, Link2, MessageSquare, Plus, ShieldCheck, Sparkles } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import {
  addComment, addMeetingNote, assignBuild, createChangeRequest, createTask, enablePortal,
  generateBrief, recordApproval, setBuildStatus, setChangeRequestStatus, updateTaskStatus, uploadDocument,
} from "../actions";
import { BuildDeleteButton } from "../build-row-actions";
import {
  APPROVAL_TYPES, BUILD_STATUSES, BUILD_STATUS_LABEL, BuildStatusBadge, CHANGE_REQUEST_STATUSES,
  TASK_STATUSES, TASK_STATUS_LABEL, TASK_TYPES, type BuildDetail, type MeetingNote,
} from "../_shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

type DjangoUser = { id: number; full_name: string; username: string };
function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

function Panel({ title, icon, children, action }: { title: string; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-950">{icon}{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export default async function BuildDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";

  // Fetch build + users + notes in parallel (one round-trip wave).
  const [build, users, notes] = await Promise.all([
    serverApi.get<BuildDetail>(`builds/builds/${id}`).catch(() => null),
    isAdmin ? serverApi.get<DjangoUser[] | { results: DjangoUser[] }>("auth/users").then(asList).catch(() => []) : Promise.resolve([] as DjangoUser[]),
    serverApi.get<MeetingNote[] | { results: MeetingNote[] }>(`builds/meeting-notes?build=${id}`).then(asList).catch(() => [] as MeetingNote[]),
  ]);
  if (!build) notFound();

  const tasks = build.tasks ?? [];
  const stages = build.stages ?? [];
  const contactSources = build.contact_sources ?? [];
  const changeRequests = build.change_requests ?? [];
  const approvals = build.approvals ?? [];
  const comments = build.comments ?? [];
  const documents = build.documents ?? [];
  const activities = build.activities ?? [];
  const integrations = build.integrations ? build.integrations.split(",").map((s) => s.trim()).filter(Boolean) : [];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <Link href="/builds" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Builds
      </Link>

      {/* Header */}
      <section className="rounded-lg border border-slate-200/80 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-1.5"><BuildStatusBadge status={build.status} /></div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{build.title}</h1>
            <p className="mt-1 text-sm text-slate-600">{build.client_name || "No client"}</p>
            <p className="mt-1 text-xs text-slate-400">Assignee: {build.assignee_name || "Unassigned"}</p>
          </div>
          <form action={setBuildStatus} className="flex items-end gap-2">
            <input type="hidden" name="id" value={id} />
            <div className="space-y-1"><Label htmlFor="status" className="text-xs">Status</Label>
              <Select id="status" name="status" defaultValue={build.status} className="h-9">
                {BUILD_STATUSES.map((s) => <option key={s} value={s}>{BUILD_STATUS_LABEL[s]}</option>)}
              </Select>
            </div>
            <Button type="submit" size="sm" variant="outline">Update</Button>
          </form>
        </div>
        {isAdmin && (
          <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-slate-100 pt-4">
            <form action={assignBuild} className="flex items-end gap-2">
              <input type="hidden" name="id" value={id} />
              <div className="space-y-1"><Label htmlFor="assigneeId" className="text-xs">Assign to</Label>
                <Select id="assigneeId" name="assigneeId" defaultValue="" className="h-9">
                  <option value="" disabled>Select member</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
                </Select>
              </div>
              <Button type="submit" size="sm">Assign</Button>
            </form>
            <form action={enablePortal}>
              <input type="hidden" name="buildId" value={id} />
              <Button type="submit" size="sm" variant="outline"><Link2 className="h-3.5 w-3.5" /> {build.client_portal_enabled ? "Portal enabled" : "Enable client portal"}</Button>
            </form>
            {build.client_portal_enabled && build.client_portal_token && (
              <span className="text-xs text-slate-500">Token: <code className="rounded bg-slate-100 px-1">{build.client_portal_token}</code></span>
            )}
            <div className="ml-auto">
              <BuildDeleteButton id={Number(id)} title={build.title} label="Delete build" />
            </div>
          </div>
        )}
      </section>

      {/* AI Brief */}
      <Panel
        title="Brief"
        icon={<Sparkles className="h-4 w-4 text-pink-700" />}
        action={isAdmin && (
          <form action={generateBrief}>
            <input type="hidden" name="buildId" value={id} />
            <Button type="submit" size="sm"><Bot className="h-3.5 w-3.5" /> {build.goals ? "Regenerate" : "Generate brief"}</Button>
          </form>
        )}
      >
        {build.goals ? (
          <div className="space-y-4 text-sm">
            <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Goals</p><p className="mt-1 text-slate-700">{build.goals}</p></div>
            {integrations.length > 0 && (
              <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Integrations</p>
                <div className="mt-1 flex flex-wrap gap-1.5">{integrations.map((i) => <span key={i} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{i}</span>)}</div>
              </div>
            )}
            {contactSources.length > 0 && (
              <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contact sources</p>
                <ul className="mt-1 list-inside list-disc text-slate-700">{contactSources.map((c) => <li key={c.id}>{c.label} <span className="text-slate-400">({c.type})</span></li>)}</ul>
              </div>
            )}
            {stages.length > 0 && (
              <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pipeline stages</p>
                <ol className="mt-1 space-y-2">{stages.map((s) => (
                  <li key={s.id} className="rounded-md border border-slate-200 p-2.5">
                    <p className="text-sm font-medium text-slate-800">{s.order}. {s.name}</p>
                    {s.description && <p className="text-xs text-slate-500">{s.description}</p>}
                    {s.manual_actions?.length > 0 && <ul className="mt-1 list-inside list-disc text-xs text-slate-600">{s.manual_actions.map((m) => <li key={m.id}>{m.description}{m.owner ? ` — ${m.owner}` : ""}</li>)}</ul>}
                  </li>
                ))}</ol>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No brief yet. Add meeting notes below, then generate the brief.</p>
        )}

        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Meeting notes ({notes.length})</p>
          {notes.length > 0 && (
            <ul className="mt-2 space-y-2">{notes.map((n) => (
              <li key={n.id} className="rounded-md bg-slate-50 p-2.5 text-xs text-slate-700">
                <span className="text-slate-400">{n.source} · {formatDate(n.created_at)}</span>
                <p className="mt-1 line-clamp-4 whitespace-pre-wrap">{n.raw_text}</p>
              </li>
            ))}</ul>
          )}
          <form action={addMeetingNote} className="mt-3 space-y-2">
            <input type="hidden" name="buildId" value={id} />
            <Textarea name="rawText" rows={3} placeholder="Add follow-up meeting notes…" required />
            <Button type="submit" size="sm" variant="outline"><Plus className="h-3.5 w-3.5" /> Add note</Button>
          </form>
        </div>
      </Panel>

      {/* Tasks */}
      <Panel title="Tasks" icon={<FileText className="h-4 w-4 text-pink-700" />}>
        {tasks.length === 0 ? <p className="text-sm text-slate-500">No tasks yet.</p> : (
          <ul className="divide-y divide-slate-100">
            {tasks.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0"><p className="text-sm font-medium text-slate-900">{t.title}</p><p className="text-xs text-slate-400">{t.type}</p></div>
                <form action={updateTaskStatus} className="flex items-center gap-2">
                  <input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="buildId" value={id} />
                  <Select name="status" defaultValue={t.status} className="h-8 text-xs">{TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}</Select>
                  <Button type="submit" size="sm" variant="outline">Set</Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={createTask} className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
          <input type="hidden" name="buildId" value={id} />
          <div className="flex-1"><Input name="title" required placeholder="New task title" className="h-9" /></div>
          <Select name="type" defaultValue="OTHER" className="h-9">{TASK_TYPES.map((t) => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}</Select>
          <Button type="submit" size="sm"><Plus className="h-3.5 w-3.5" /> Add</Button>
        </form>
      </Panel>

      {/* Change requests */}
      <Panel title="Change requests" icon={<MessageSquare className="h-4 w-4 text-pink-700" />}>
        {changeRequests.length === 0 ? <p className="text-sm text-slate-500">No change requests.</p> : (
          <ul className="space-y-2">{changeRequests.map((c) => (
            <li key={c.id} className="rounded-md border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-sm font-medium text-slate-900">{c.title}</p><p className="text-xs text-slate-600">{c.description}</p>{c.impact && <p className="mt-0.5 text-xs text-slate-400">Impact: {c.impact}</p>}</div>
                {isAdmin ? (
                  <form action={setChangeRequestStatus} className="flex items-center gap-1.5">
                    <input type="hidden" name="id" value={c.id} /><input type="hidden" name="buildId" value={id} />
                    <Select name="status" defaultValue={c.status} className="h-8 text-xs">{CHANGE_REQUEST_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
                    <Button type="submit" size="sm" variant="outline">Save</Button>
                  </form>
                ) : <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{c.status}</span>}
              </div>
            </li>
          ))}</ul>
        )}
        <form action={createChangeRequest} className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <input type="hidden" name="buildId" value={id} />
          <Input name="title" required placeholder="Change request title" className="h-9" />
          <Textarea name="description" rows={2} required placeholder="Describe the change…" />
          <Input name="impact" placeholder="Impact (optional)" className="h-9" />
          <Button type="submit" size="sm" variant="outline"><Plus className="h-3.5 w-3.5" /> Raise change request</Button>
        </form>
      </Panel>

      {/* Approvals */}
      <Panel title="Approvals" icon={<ShieldCheck className="h-4 w-4 text-pink-700" />}>
        {approvals.length === 0 ? <p className="text-sm text-slate-500">No approvals recorded.</p> : (
          <ul className="space-y-1.5">{approvals.map((a) => (
            <li key={a.id} className="flex items-center justify-between text-sm">
              <span className="font-medium text-slate-800">{a.type}{a.note ? ` — ${a.note}` : ""}</span>
              <span className="text-xs text-slate-400">{a.approver_name} · {formatDate(a.created_at)}</span>
            </li>
          ))}</ul>
        )}
        {isAdmin && (
          <form action={recordApproval} className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
            <input type="hidden" name="buildId" value={id} />
            <Select name="type" defaultValue="BRIEF" className="h-9">{APPROVAL_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</Select>
            <div className="flex-1"><Input name="note" placeholder="Note (optional)" className="h-9" /></div>
            <Button type="submit" size="sm">Record approval</Button>
          </form>
        )}
      </Panel>

      {/* Files */}
      <Panel title="Files" icon={<FileText className="h-4 w-4 text-pink-700" />}>
        {documents.length === 0 ? <p className="text-sm text-slate-500">No files.</p> : (
          <ul className="space-y-1.5">{documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between text-sm">
              <a href={d.url} target="_blank" rel="noreferrer" className="font-medium text-pink-700 hover:underline">{d.filename}</a>
              <span className="text-xs text-slate-400">{d.uploaded_by_name} · {formatDate(d.created_at)}</span>
            </li>
          ))}</ul>
        )}
        <form action={uploadDocument} className="mt-3 flex items-end gap-2 border-t border-slate-100 pt-3">
          <input type="hidden" name="buildId" value={id} />
          <input type="file" name="file" required className="text-sm" />
          <Button type="submit" size="sm" variant="outline"><Plus className="h-3.5 w-3.5" /> Upload</Button>
        </form>
      </Panel>

      {/* Comments */}
      <Panel title="Comments" icon={<MessageSquare className="h-4 w-4 text-pink-700" />}>
        {comments.length === 0 ? <p className="text-sm text-slate-500">No comments.</p> : (
          <ul className="space-y-3">{comments.map((c) => (
            <li key={c.id} className="text-sm">
              <p className="text-slate-800">{c.body}</p>
              <p className="text-xs text-slate-400">{c.author_name} · {formatDate(c.created_at)}</p>
            </li>
          ))}</ul>
        )}
        <form action={addComment} className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <input type="hidden" name="buildId" value={id} />
          <Textarea name="body" rows={2} required placeholder="Write a comment…" />
          <Button type="submit" size="sm" variant="outline">Comment</Button>
        </form>
      </Panel>

      {/* Activity */}
      {activities.length > 0 && (
        <Panel title="Activity" icon={<FileText className="h-4 w-4 text-pink-700" />}>
          <ul className="space-y-1.5">{activities.map((a) => (
            <li key={a.id} className="flex items-center justify-between text-xs">
              <span className="text-slate-700"><span className="font-medium">{a.actor}</span> {a.message}</span>
              <span className="text-slate-400">{formatDate(a.created_at)}</span>
            </li>
          ))}</ul>
        </Panel>
      )}
    </div>
  );
}
