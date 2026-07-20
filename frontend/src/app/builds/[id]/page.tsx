import { notFound } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, FileText, Link2, MessageSquare,
  Plus, ShieldCheck, Sparkles, ListChecks,
} from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import {
  addComment, convertSectionBlockerToTask, createChangeRequest, createTask, deleteChangeRequest, enablePortal,
  generateChangeRequestSteps, recordApproval, setBuildStatus, setChangeRequestStatus,
  requestSectionBlockerInfo, uploadDocument,
} from "../actions";
import { AssignApprove } from "../assign-approve";
import { NoteComposer } from "../note-composer";
import { BuildDeleteButton, ConfirmDeleteButton } from "../build-row-actions";
import { TaskCard } from "../task-card";
import { PortalLink } from "../portal-link";
import { BuilderDocPanel } from "../builder-doc";
import { ProgressReportPanel } from "../progress-report";
import { MeetingNoteUpload } from "../meeting-note-upload";
import { SectionControls } from "../implementation-workspace";
import { MeetingTasklistPanel } from "../meeting-tasklist";
import { Tabs, TabPanel } from "../build-tabs";
import {
  APPROVAL_TYPES, BUILD_STATUSES, BUILD_STATUS_LABEL, BuildStatusBadge, CHANGE_REQUEST_STATUSES,
  CHANGE_REQUEST_STATUS_LABEL,
  TASK_TYPES, MEETING_NOTE_KIND_LABEL,
  type BuildDetail, type ChangeRequest, type MeetingNote, type DjangoUser,
} from "../_shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

function Panel({ title, icon, children, action }: { title: string; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-950">{icon}{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function ChangeRequestCard({
  change,
  buildId,
  canManageBuilds,
}: {
  change: ChangeRequest;
  buildId: string;
  canManageBuilds: boolean;
}) {
  const statusOptions = CHANGE_REQUEST_STATUSES.filter((s) => s !== "BLOCKED");
  return (
    <li className={`rounded-md border p-3 ${change.status === "BLOCKED" ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">{change.title}</p>
          <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{change.description}</p>
          {change.impact && <p className="mt-1 text-xs text-slate-400">Impact: {change.impact}</p>}
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
            <span>Status: <strong>{CHANGE_REQUEST_STATUS_LABEL[change.status] ?? change.status}</strong></span>
            {change.owner_name && <span>Owner: <strong>{change.owner_name}</strong></span>}
            {change.due_date && <span>Due: <strong>{formatDate(change.due_date)}</strong></span>}
          </div>
        </div>
        {canManageBuilds ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <form action={setChangeRequestStatus} className="flex items-center gap-1.5">
              <input type="hidden" name="id" value={change.id} />
              <input type="hidden" name="buildId" value={buildId} />
              <Select name="status" defaultValue={change.status === "BLOCKED" ? "IN_BUILD" : change.status} className="h-8 text-xs">
                {statusOptions.map((s) => <option key={s} value={s}>{CHANGE_REQUEST_STATUS_LABEL[s]}</option>)}
              </Select>
              <Button type="submit" size="sm" variant="outline">Save</Button>
            </form>
            <ConfirmDeleteButton action={deleteChangeRequest} fields={{ id: change.id, buildId }}
              title="Delete change request" message={`Delete change request "${change.title}"?`} />
          </div>
        ) : <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{CHANGE_REQUEST_STATUS_LABEL[change.status] ?? change.status}</span>}
      </div>

      {change.status === "BLOCKED" && change.blocker_note && (
        <div className="mt-3 rounded-md border border-red-200 bg-white/70 p-3 text-xs text-red-800">
          <p className="font-semibold">Blocker</p>
          <p className="mt-1 whitespace-pre-wrap">{change.blocker_note}</p>
          {change.blocker_attachment_url && (
            <a href={change.blocker_attachment_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex font-semibold text-red-700 underline">
              {change.blocker_attachment_name || "View attachment"}
            </a>
          )}
        </div>
      )}

      {change.implementation_steps && (
        <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-700">Implementation steps</summary>
          <pre className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{change.implementation_steps}</pre>
        </details>
      )}

      {canManageBuilds && (
        <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 md:grid-cols-2">
          <form action={setChangeRequestStatus} className="space-y-2">
            <input type="hidden" name="id" value={change.id} />
            <input type="hidden" name="buildId" value={buildId} />
            <input type="hidden" name="status" value="BLOCKED" />
            <Textarea name="blockerNote" rows={2} required placeholder="Block this update: what is missing or stuck?" />
            <input type="file" name="blockerFile" className="text-xs" />
            <Button type="submit" size="sm" variant="outline" className="border-red-200 text-red-700 hover:bg-red-50">Submit blocker</Button>
          </form>
          <form action={generateChangeRequestSteps} className="flex items-end justify-end">
            <input type="hidden" name="id" value={change.id} />
            <input type="hidden" name="buildId" value={buildId} />
            <Button type="submit" size="sm" variant="outline"><Sparkles className="h-3.5 w-3.5" /> Generate steps</Button>
          </form>
        </div>
      )}
    </li>
  );
}

export default async function BuildDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const canManageBuilds = user.role === "ADMIN" || (user.features ?? []).includes("builds_manage");

  // Fetch build + notes in parallel (one round-trip wave); users list depends on
  // isOwner, which needs `build`, so it's fetched just after.
  const [build, notes] = await Promise.all([
    serverApi.get<BuildDetail>(`builds/builds/${id}`).catch(() => null),
    serverApi.get<MeetingNote[] | { results: MeetingNote[] }>(`builds/meeting-notes?build=${id}`).then(asList).catch(() => [] as MeetingNote[]),
  ]);
  if (!build) notFound();

  // Reads are open to all staff, but the backend limits build writes to a manager
  // OR the build owner (assignee). Mirror that here so non-owners don't see status
  // controls that would 403. Admin-only actions stay gated by canManageBuilds below.
  const isOwner = build.assignee != null && String(build.assignee) === user.id;
  const canManage = canManageBuilds || isOwner;

  // Needed to populate the task-assignee / change-request-owner dropdowns.
  // `auth/users` (the staff roster) is manager/`team`-feature-gated on the backend
  // (Auth/views.py list_users), so non-admin build owners still see the empty
  // fallback ("Assignee: build assignee") rather than a picker — same limit the
  // existing change-request owner dropdown already has.
  const users = canManageBuilds
    ? await serverApi.get<DjangoUser[] | { results: DjangoUser[] }>("auth/users").then(asList).catch(() => [] as DjangoUser[])
    : ([] as DjangoUser[]);

  const tasks = build.tasks ?? [];
  const changeRequests = build.change_requests ?? [];
  const approvals = build.approvals ?? [];
  const sectionReviews = build.section_reviews ?? [];
  const blockedSections = sectionReviews.filter((r) => r.status === "BLOCKED");
  const clientUpdatesReview = sectionReviews.find((r) => r.section === "CLIENT_UPDATES");
  const unresolvedClientUpdates = changeRequests.filter((c) => !["IMPLEMENTED", "REJECTED", "DEFERRED"].includes(c.status));
  const comments = build.comments ?? [];
  const actionItems = build.action_items ?? [];
  const activeActionItems = actionItems.filter((i) => !i.superseded);
  const documents = build.documents ?? [];
  const activities = build.activities ?? [];
  const integrations = build.integrations ? build.integrations.split(",").map((s) => s.trim()).filter(Boolean) : [];
  // A build is ready to hand over once its tasklist has been captured from the notes.
  const hasPlan = activeActionItems.length > 0;

  return (
    <div className="w-full space-y-5">
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
          {canManage && (
            <form action={setBuildStatus} className="flex items-end gap-2">
              <input type="hidden" name="id" value={id} />
              <div className="space-y-1"><Label htmlFor="status" className="text-xs">Status</Label>
                <Select id="status" name="status" defaultValue={build.status} className="h-9">
                  {BUILD_STATUSES.map((s) => <option key={s} value={s}>{BUILD_STATUS_LABEL[s]}</option>)}
                </Select>
              </div>
              <Button type="submit" size="sm" variant="outline">Update</Button>
            </form>
          )}
        </div>

        {/* Assign + approve are one control: pick a member, then either just assign,
            or approve the build-out (records sign-off + notifies). Client-side so a
            missing-member click toasts instead of erroring. */}
        {canManageBuilds && (
          <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
            <AssignApprove
              buildId={id}
              members={users.map((u) => ({ id: u.id, name: u.full_name || u.username }))}
              defaultAssigneeId={build.assignee != null ? String(build.assignee) : ""}
              canApprove={hasPlan && build.status !== "DELIVERED"}
            />
            <form action={enablePortal}>
              <input type="hidden" name="buildId" value={id} />
              <Button type="submit" size="sm" variant="outline"><Link2 className="h-3.5 w-3.5" /> {build.client_portal_enabled ? "Portal enabled" : "Enable client portal"}</Button>
            </form>
            {build.client_portal_enabled && build.client_portal_token && (
              <div className="w-full"><PortalLink token={build.client_portal_token} /></div>
            )}
            <div className="ml-auto"><BuildDeleteButton id={Number(id)} title={build.title} label="Delete build" /></div>
            {hasPlan && build.status !== "DELIVERED" && (
              <p className="w-full text-xs text-slate-400">Assign hands the build over; Approve also records sign-off and notifies the staff member to start implementing.</p>
            )}
          </div>
        )}
      </section>

      <Tabs>
        {/* ── Overview ─────────────────────────────────────────────── */}
        <TabPanel id="overview" label="Overview">
          <Panel title="Overview & meeting notes" icon={<Sparkles className="h-4 w-4 text-pink-700" />}>
            {(build.overview || build.one_line_summary || build.goals || integrations.length > 0) && (
              <div className="space-y-4 text-sm">
                {build.overview && (
                  <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">The big idea</p>
                    <p className="mt-1 whitespace-pre-wrap text-slate-700">{build.overview}</p>
                  </div>
                )}
                {build.one_line_summary && (
                  <p className="rounded-md border-l-2 border-pink-300 bg-pink-50/50 px-3 py-2 text-slate-700">{build.one_line_summary}</p>
                )}
                {build.goals && (
                  <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Goals</p><p className="mt-1 text-slate-700">{build.goals}</p></div>
                )}
                {integrations.length > 0 && (
                  <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Integrations</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">{integrations.map((i) => <span key={i} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{i}</span>)}</div>
                  </div>
                )}
              </div>
            )}
            <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-600">
              Capture the meeting notes here, then build the source-faithful checklist in the
              <span className="font-semibold"> Meeting Tasklist</span> tab and implement it by GHL section in
              <span className="font-semibold"> Implementation</span>.
            </div>

            <div className="mt-5 border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Meeting history ({notes.length})</p>
              {notes.length > 0 && (
                <ul className="mt-2 space-y-2">{notes.map((n) => (
                  <li key={n.id} className="rounded-md bg-slate-50 p-2.5 text-xs text-slate-700">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-2">
                        <span className="font-semibold text-slate-800">{n.title || MEETING_NOTE_KIND_LABEL[n.kind ?? "meeting"] || "Notes"}</span>
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">{MEETING_NOTE_KIND_LABEL[n.kind ?? "meeting"] ?? "Note"}</span>
                        {n.ai_status === "processing" && <span className="text-[10px] text-amber-600">processing…</span>}
                      </span>
                      <span className="text-slate-400">{formatDate(n.created_at)}</span>
                    </div>
                    <p className="mt-1 line-clamp-4 whitespace-pre-wrap">{n.raw_text}</p>
                  </li>
                ))}</ul>
              )}
              <NoteComposer buildId={id} />
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-slate-400">or upload a file</span>
                <MeetingNoteUpload buildId={id} />
                <span className="text-xs text-slate-400">PDF, DOCX, TXT, CSV, MD, RTF</span>
              </div>
            </div>
          </Panel>
        </TabPanel>

        {/* ── Implementation (the persisted build document) ────────── */}
        <TabPanel id="implementation" label="Implementation">
          <Panel
            title="Implementation build document"
            icon={<FileText className="h-4 w-4 text-pink-700" />}
          >
            <BuilderDocPanel
              buildId={id}
              title={build.title}
              initialMarkdown={build.build_document ?? ""}
              generatedAt={build.build_document_at}
              notes={notes}
              canManage={canManage}
            />
          </Panel>
          {canManage && (
            <div className="mt-5">
              <ProgressReportPanel buildId={id} reports={build.progress_reports ?? []} />
            </div>
          )}
        </TabPanel>

        <TabPanel id="updates" label="New Updates" count={changeRequests.length}>
          <Panel title="Client-added features & mid-build updates" icon={<MessageSquare className="h-4 w-4 text-pink-700" />}>
            <div className="space-y-4">
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Use this tab when the client adds a feature or changes scope midway. Log the update as a progress/change note, let the AI extract change requests and gaps, then track implementation in the Implementation tab under “New Features & Updates.”
              </div>
              {unresolvedClientUpdates.length > 0 && (
                <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
                  {unresolvedClientUpdates.length} update{unresolvedClientUpdates.length === 1 ? "" : "s"} still need a final status before this section can be marked done.
                </p>
              )}
              <SectionControls buildId={id} section="CLIENT_UPDATES" review={clientUpdatesReview} />

              {changeRequests.length === 0 ? <p className="text-sm text-slate-500">No client-added features or change requests yet.</p> : (
                <ul className="space-y-2">{changeRequests.map((c) => (
                  <ChangeRequestCard key={c.id} change={c} buildId={id} canManageBuilds={canManageBuilds} />
                ))}</ul>
              )}

              <form action={createChangeRequest} className="space-y-2 border-t border-slate-100 pt-3">
                <input type="hidden" name="buildId" value={id} />
                <div className="grid gap-2 md:grid-cols-2">
                  <Input name="title" required placeholder="New feature or update title" className="h-9" />
                  <Input name="dueDate" type="datetime-local" className="h-9" />
                </div>
                <Textarea name="description" rows={3} required placeholder="Describe what the client added or changed…" />
                <div className="grid gap-2 md:grid-cols-2">
                  <Input name="impact" placeholder="Impact, dependency, or approval needed (optional)" className="h-9" />
                  <Select name="owner" defaultValue="" className="h-9">
                    <option value="">Owner: build assignee</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
                  </Select>
                </div>
                <Button type="submit" size="sm" variant="outline"><Plus className="h-3.5 w-3.5" /> Add update</Button>
              </form>

              <div className="border-t border-slate-100 pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Log unstructured update notes</p>
                <NoteComposer buildId={id} />
              </div>
            </div>
          </Panel>
        </TabPanel>

        {/* ── Tasks ────────────────────────────────────────────────── */}
        <TabPanel id="tasks" label="Tasks" count={tasks.length}>
          <Panel title="Tasks" icon={<FileText className="h-4 w-4 text-pink-700" />}>
            {tasks.length === 0 ? <p className="text-sm text-slate-500">No tasks yet.</p> : (
              <ul className="space-y-2.5">
                {tasks.map((t) => (
                  <TaskCard key={t.id} task={t} buildId={id} canManage={canManage} canManageBuilds={canManageBuilds} users={users} />
                ))}
              </ul>
            )}
            <form action={createTask} className="mt-3 space-y-2 border-t border-slate-100 pt-3">
              <input type="hidden" name="buildId" value={id} />
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1"><Input name="title" required placeholder="New task or concern title" className="h-9" /></div>
                <Select name="type" defaultValue="OTHER" className="h-9">{TASK_TYPES.map((t) => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}</Select>
              </div>
              <Textarea name="description" rows={2} placeholder="Describe the concern or what needs to be done…" />
              <div className="flex flex-wrap items-end gap-2">
                <Select name="assignee" defaultValue="" className="h-9">
                  <option value="">Assignee: build assignee</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
                </Select>
                <Button type="submit" size="sm"><Plus className="h-3.5 w-3.5" /> Add</Button>
              </div>
            </form>
          </Panel>
        </TabPanel>

        {/* ── Meeting Tasklist (source-faithful capture) ───────────── */}
        <TabPanel id="meeting-tasklist" label="Meeting Tasklist" count={activeActionItems.length}>
          <Panel title="Meeting tasklist" icon={<ListChecks className="h-4 w-4 text-pink-700" />}>
            <p className="mb-4 text-xs text-slate-500">
              A faithful, exhaustive capture of every request, change, question, and decision straight from
              the meeting notes — organized by GHL section. Re-sync after each meeting to keep one living list.
            </p>
            <MeetingTasklistPanel
              buildId={id}
              title={build.title}
              items={actionItems}
              notes={notes}
              canManage={canManage}
              tasklistStatus={build.tasklist_status}
            />
          </Panel>
        </TabPanel>

        {/* ── Activity (collaboration) ─────────────────────────────── */}
        <TabPanel id="activity" label="Activity">
          {blockedSections.length > 0 && (
            <Panel title="Section blockers" icon={<AlertTriangle className="h-4 w-4 text-red-600" />}>
              <ul className="space-y-2">
                {blockedSections.map((r) => (
                  <li key={r.id} className="rounded-md border border-red-200 bg-red-50 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-red-800">{r.section.replace(/_/g, " ")}</p>
                      <span className="text-xs text-red-600">{r.blocked_by_name || "Staff"} · {r.blocked_at ? formatDate(r.blocked_at) : "Blocked"}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-red-800">{r.blocker_note}</p>
                    {r.blocker_attachment_url && (
                      <a href={r.blocker_attachment_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-semibold text-red-700 underline">
                        {r.blocker_attachment_name || "View attachment"}
                      </a>
                    )}
                    {canManage && (
                      <div className="mt-3 grid gap-2 border-t border-red-100 pt-3 md:grid-cols-2">
                        <form action={requestSectionBlockerInfo} className="space-y-2">
                          <input type="hidden" name="reviewId" value={r.id} />
                          <input type="hidden" name="buildId" value={id} />
                          <Textarea name="note" rows={2} required placeholder="Ask for more detail…" />
                          <Button type="submit" size="sm" variant="outline">Request info</Button>
                        </form>
                        <div className="flex flex-wrap items-end justify-end gap-2">
                          <form action={convertSectionBlockerToTask}>
                            <input type="hidden" name="reviewId" value={r.id} />
                            <input type="hidden" name="buildId" value={id} />
                            <Button type="submit" size="sm" variant="outline">Convert to task</Button>
                          </form>
                          <SectionControls buildId={id} section={r.section} review={r} />
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="Change requests" icon={<MessageSquare className="h-4 w-4 text-pink-700" />}>
            {changeRequests.length === 0 ? <p className="text-sm text-slate-500">No change requests.</p> : (
              <ul className="space-y-2">{changeRequests.map((c) => (
                <ChangeRequestCard key={c.id} change={c} buildId={id} canManageBuilds={canManageBuilds} />
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

          <Panel title="Approvals" icon={<ShieldCheck className="h-4 w-4 text-pink-700" />}>
            {approvals.length === 0 ? <p className="text-sm text-slate-500">No approvals recorded.</p> : (
              <ul className="space-y-1.5">{approvals.map((a) => (
                <li key={a.id} className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-800">{a.type}{a.note ? ` — ${a.note}` : ""}</span>
                  <span className="text-xs text-slate-400">{a.approver_name} · {formatDate(a.created_at)}</span>
                </li>
              ))}</ul>
            )}
            {canManageBuilds && (
              <form action={recordApproval} className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
                <input type="hidden" name="buildId" value={id} />
                <Select name="type" defaultValue="BRIEF" className="h-9">{APPROVAL_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</Select>
                <div className="flex-1"><Input name="note" placeholder="Note (optional)" className="h-9" /></div>
                <Button type="submit" size="sm">Record approval</Button>
              </form>
            )}
          </Panel>

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
        </TabPanel>
      </Tabs>
    </div>
  );
}
