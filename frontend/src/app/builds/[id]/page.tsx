import { notFound } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, ArrowRight, CalendarClock, FileText, GitBranch, Link2, MessageSquare, Plug,
  Plus, ShieldCheck, Sparkles, Tag, Workflow as WorkflowIcon, ListChecks, HelpCircle,
} from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import {
  addComment, convertSectionBlockerToTask, createChangeRequest, createTask, deleteChangeRequest, deleteGap, deleteTask, enablePortal,
  generateChangeRequestSteps, recordApproval, setBuildStatus, setChangeRequestStatus, togglePreLaunchItem,
  requestSectionBlockerInfo, updateTaskStatus, uploadDocument,
} from "../actions";
import { AssignApprove } from "../assign-approve";
import { NoteComposer } from "../note-composer";
import { GapResolver } from "../gap-resolver";
import { BuildDeleteButton, ConfirmDeleteButton } from "../build-row-actions";
import { PortalLink } from "../portal-link";
import { GenerateBriefButton } from "../generate-brief-button";
import { BuildDocumentButton, HandoverButton } from "../handover-button";
import { MeetingNoteUpload } from "../meeting-note-upload";
import { RunQaButton, GenerateSopButton } from "../ai-buttons";
import { BlueprintEditor } from "../blueprint-editor";
import { ImplementationWorkspace, SectionControls } from "../implementation-workspace";
import { Tabs, TabPanel } from "../build-tabs";
import {
  APPROVAL_TYPES, BUILD_STATUSES, BUILD_STATUS_LABEL, BuildStatusBadge, CHANGE_REQUEST_STATUSES,
  CHANGE_REQUEST_STATUS_LABEL,
  CALENDAR_TYPE_LABEL, ProvBadge,
  INTEGRATION_DIRECTION_LABEL, INTEGRATION_DIRECTION_STYLE, INTEGRATION_MECHANISM_LABEL,
  TASK_STATUSES, TASK_STATUS_LABEL, TASK_TYPES, MEETING_NOTE_KIND_LABEL,
  WORKFLOW_CATEGORY_LABEL, type BuildDetail, type ChangeRequest, type MeetingNote, type Workflow,
} from "../_shared";
import { Badge } from "@/components/ui/badge";
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

  // Fetch build + users + notes in parallel (one round-trip wave).
  const [build, users, notes] = await Promise.all([
    serverApi.get<BuildDetail>(`builds/builds/${id}`).catch(() => null),
    canManageBuilds ? serverApi.get<DjangoUser[] | { results: DjangoUser[] }>("auth/users").then(asList).catch(() => []) : Promise.resolve([] as DjangoUser[]),
    serverApi.get<MeetingNote[] | { results: MeetingNote[] }>(`builds/meeting-notes?build=${id}`).then(asList).catch(() => [] as MeetingNote[]),
  ]);
  if (!build) notFound();

  // Reads are open to all staff, but the backend limits build writes to a manager
  // OR the build owner (assignee). Mirror that here so non-owners don't see status
  // controls that would 403. Admin-only actions stay gated by canManageBuilds below.
  const isOwner = build.assignee != null && String(build.assignee) === user.id;
  const canManage = canManageBuilds || isOwner;

  const tasks = build.tasks ?? [];
  const stages = build.stages ?? [];
  const stageName = new Map(stages.map((s) => [s.id, s.name]));
  const contactSources = build.contact_sources ?? [];
  const calendars = build.calendars ?? [];
  const integrationLinks = build.external_integrations ?? [];
  const transitions = build.transitions ?? [];
  const workflows = build.workflows ?? [];
  const customFields = build.custom_fields ?? [];
  const tags = build.tags ?? [];
  const preLaunch = build.pre_launch_items ?? [];
  const gaps = build.gaps ?? [];
  const openGaps = gaps.filter((g) => g.status === "OPEN");
  const resolvedGaps = gaps.filter((g) => g.status !== "OPEN");
  const changeRequests = build.change_requests ?? [];
  const approvals = build.approvals ?? [];
  const sectionReviews = build.section_reviews ?? [];
  const blockedSections = sectionReviews.filter((r) => r.status === "BLOCKED");
  const clientUpdatesReview = sectionReviews.find((r) => r.section === "CLIENT_UPDATES");
  const unresolvedClientUpdates = changeRequests.filter((c) => !["IMPLEMENTED", "REJECTED", "DEFERRED"].includes(c.status));
  const comments = build.comments ?? [];
  const documents = build.documents ?? [];
  const activities = build.activities ?? [];
  const qaSnapshots = (build.memory_snapshots ?? []).filter((s) => (s.summary || "").startsWith("AI QA:"));
  const latestQa = [...qaSnapshots].sort((a, b) => b.id - a.id)[0];
  const integrations = build.integrations ? build.integrations.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const hasBlueprint = Boolean(build.overview || build.goals || stages.length);

  // Vision-completeness: how many handover sections are captured.
  const sectionChecks = [
    Boolean(build.overview), contactSources.length > 0, calendars.length > 0, integrationLinks.length > 0,
    stages.length > 0, transitions.length > 0, workflows.length > 0, customFields.length > 0, tags.length > 0,
  ];
  const captured = sectionChecks.filter(Boolean).length;
  const completeness = Math.round((captured / sectionChecks.length) * 100);

  // Group workflows by category for the handover-style §5 layout.
  const workflowsByCategory = workflows.reduce<Record<string, Workflow[]>>((acc, w) => {
    (acc[w.category] ??= []).push(w);
    return acc;
  }, {});
  const transitionLabel = (t: typeof transitions[number], which: "from" | "to") => {
    const id = which === "from" ? t.from_stage : t.to_stage;
    const fallback = which === "from" ? t.from_label : t.to_label;
    return (id != null ? stageName.get(id) : null) ?? fallback ?? "—";
  };

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
              canApprove={hasBlueprint && build.status !== "DELIVERED"}
            />
            <form action={enablePortal}>
              <input type="hidden" name="buildId" value={id} />
              <Button type="submit" size="sm" variant="outline"><Link2 className="h-3.5 w-3.5" /> {build.client_portal_enabled ? "Portal enabled" : "Enable client portal"}</Button>
            </form>
            {build.client_portal_enabled && build.client_portal_token && (
              <div className="w-full"><PortalLink token={build.client_portal_token} /></div>
            )}
            <div className="ml-auto"><BuildDeleteButton id={Number(id)} title={build.title} label="Delete build" /></div>
            {hasBlueprint && build.status !== "DELIVERED" && (
              <p className="w-full text-xs text-slate-400">Assign hands the build over; Approve also records sign-off and notifies the staff member to start implementing.</p>
            )}
          </div>
        )}
      </section>

      <Tabs>
        {/* ── Overview ─────────────────────────────────────────────── */}
        <TabPanel id="overview" label="Overview">
          <Panel
            title="Vision blueprint"
            icon={<Sparkles className="h-4 w-4 text-pink-700" />}
            action={canManageBuilds && (
              <div className="flex flex-wrap items-center gap-2">
                <GenerateBriefButton buildId={id} hasBrief={hasBlueprint} />
                {hasBlueprint && <RunQaButton buildId={id} />}
                {hasBlueprint && <HandoverButton buildId={id} title={build.title} />}
              </div>
            )}
          >
            {hasBlueprint ? (
              <div className="space-y-4 text-sm">
                {/* Completeness meter */}
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
                    <span>Vision captured</span>
                    <span className={completeness === 100 ? "text-emerald-600" : "text-slate-700"}>
                      {captured}/{sectionChecks.length} sections · {completeness}%
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full ${completeness === 100 ? "bg-emerald-500" : "bg-pink-500"}`}
                      style={{ width: `${completeness}%` }}
                    />
                  </div>
                  {openGaps.length > 0 && (
                    <p className="mt-2 text-xs text-amber-700">
                      {openGaps.length} open gap{openGaps.length === 1 ? "" : "s"} the AI flagged — see the “Gaps &amp; QA” tab.
                    </p>
                  )}
                </div>

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
            ) : (
              <p className="text-sm text-slate-500">No blueprint yet. Add meeting notes below, then generate the blueprint.</p>
            )}

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

        {/* ── Build-out (the named system) ─────────────────────────── */}
        {hasBlueprint && (
          <TabPanel id="implementation" label="Implementation">
            <Panel
              title="Staff implementation workspace"
              icon={<ListChecks className="h-4 w-4 text-pink-700" />}
              action={<BuildDocumentButton buildId={id} title={build.title} />}
            >
              <ImplementationWorkspace build={build} buildId={id} notes={notes} />
            </Panel>
          </TabPanel>
        )}

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

        {/* ── Build-out (the named system) ─────────────────────────── */}
        {hasBlueprint && (
          <TabPanel id="buildout" label="Build-out">
            {contactSources.length > 0 && (
              <Panel title="Lead sources" icon={<Link2 className="h-4 w-4 text-pink-700" />}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead><tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-3">Source</th><th className="py-2 pr-3">How it enters</th><th className="py-2 pr-3">Fires</th><th className="py-2 pr-3">Tags</th><th className="py-2 pr-3">Workflow</th><th className="py-2">Entry stage</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-50">{contactSources.map((c) => (
                      <tr key={c.id} className="align-top">
                        <td className="py-2 pr-3"><span className="font-medium text-slate-800">{c.label}</span> <span className="text-xs text-slate-400">({c.type})</span> <ProvBadge inferred={c.inferred} confidence={c.confidence} /></td>
                        <td className="py-2 pr-3 text-slate-600">{c.entry_mechanism || "—"}</td>
                        <td className="py-2 pr-3 text-slate-600">{c.fires || "—"}</td>
                        <td className="py-2 pr-3 font-mono text-xs text-slate-500">{c.tags_applied || "—"}</td>
                        <td className="py-2 pr-3 font-mono text-xs text-slate-500">{c.handling_workflow || "—"}</td>
                        <td className="py-2 text-slate-600">{c.entry_stage != null ? stageName.get(c.entry_stage) ?? "—" : "—"}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </Panel>
            )}

            {calendars.length > 0 && (
              <Panel title="Calendars — conversion points" icon={<CalendarClock className="h-4 w-4 text-pink-700" />}>
                <ul className="space-y-2">{calendars.map((c) => (
                  <li key={c.id} className="rounded-md border border-slate-200 p-2.5 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-slate-800">{c.name}</p>
                      <Badge className="bg-slate-100 text-slate-600">{CALENDAR_TYPE_LABEL[c.type] ?? c.type}</Badge>
                      <ProvBadge inferred={c.inferred} confidence={c.confidence} />
                      {c.books_into_stage != null && stageName.get(c.books_into_stage) && (
                        <span className="text-xs text-slate-400">→ books into {stageName.get(c.books_into_stage)}</span>
                      )}
                    </div>
                    {c.purpose && <p className="mt-0.5 text-xs text-slate-500"><span className="font-semibold">Books:</span> {c.purpose}</p>}
                    {c.assigned_to && <p className="mt-0.5 text-xs text-slate-500"><span className="font-semibold">Assigned to:</span> {c.assigned_to}</p>}
                    {c.on_booking && <p className="mt-0.5 text-xs text-slate-500"><span className="font-semibold">On booking:</span> {c.on_booking}</p>}
                    {c.reminders && <p className="mt-0.5 text-xs text-slate-500"><span className="font-semibold">Reminders:</span> {c.reminders}</p>}
                  </li>
                ))}</ul>
              </Panel>
            )}

            {integrationLinks.length > 0 && (
              <Panel title="Integrations & data flows" icon={<Plug className="h-4 w-4 text-pink-700" />}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead><tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-3">System</th><th className="py-2 pr-3">Direction</th><th className="py-2 pr-3">Mechanism</th><th className="py-2 pr-3">Data</th><th className="py-2 pr-3">Cadence</th><th className="py-2">Purpose</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-50">{integrationLinks.map((ig) => (
                      <tr key={ig.id} className="align-top">
                        <td className="py-2 pr-3 font-medium text-slate-800">{ig.name} <ProvBadge inferred={ig.inferred} confidence={ig.confidence} /></td>
                        <td className="py-2 pr-3"><Badge className={INTEGRATION_DIRECTION_STYLE[ig.direction] ?? "bg-slate-100 text-slate-600"}>{INTEGRATION_DIRECTION_LABEL[ig.direction] ?? ig.direction}</Badge></td>
                        <td className="py-2 pr-3 text-slate-600">{INTEGRATION_MECHANISM_LABEL[ig.mechanism] ?? ig.mechanism}</td>
                        <td className="py-2 pr-3 text-slate-600">{ig.data_objects || "—"}</td>
                        <td className="py-2 pr-3 text-slate-500">{ig.trigger_cadence || "—"}</td>
                        <td className="py-2 text-slate-600">{ig.purpose || "—"}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </Panel>
            )}

            {stages.length > 0 && (
              <Panel title="Pipeline" icon={<GitBranch className="h-4 w-4 text-pink-700" />}>
                <ol className="space-y-2">{stages.map((s) => (
                  <li key={s.id} className="rounded-md border border-slate-200 p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-slate-800">{s.order}. {s.name}</p>
                      <Badge className={s.is_automatic ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-700"}>{s.is_automatic ? "Auto" : "Manual"}</Badge>
                      <ProvBadge inferred={s.inferred} confidence={s.confidence} />
                    </div>
                    {s.description && <p className="mt-0.5 text-xs text-slate-500"><span className="font-semibold">What it means:</span> {s.description}</p>}
                    {s.entry_condition && <p className="mt-0.5 text-xs text-slate-500"><span className="font-semibold">How a lead gets here:</span> {s.entry_condition}</p>}
                    {s.manual_actions?.length > 0 && <ul className="mt-1 list-inside list-disc text-xs text-slate-600">{s.manual_actions.map((m) => <li key={m.id}>{m.description}{m.owner ? ` — ${m.owner}` : ""}</li>)}</ul>}
                  </li>
                ))}</ol>
              </Panel>
            )}

            {transitions.length > 0 && (
              <Panel title="Stage movement" icon={<ArrowRight className="h-4 w-4 text-pink-700" />}>
                <ul className="space-y-1.5">{transitions.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700">
                      {transitionLabel(t, "from")} <ArrowRight className="h-3 w-3 text-slate-400" /> {transitionLabel(t, "to")}
                    </span>
                    <span className="text-slate-600">{t.trigger}</span>
                    <Badge className={t.is_automatic ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-700"}>{t.is_automatic ? "Auto" : "Manual"}</Badge>
                  </li>
                ))}</ul>
              </Panel>
            )}

            {workflows.length > 0 && (
              <Panel title="Workflows" icon={<WorkflowIcon className="h-4 w-4 text-pink-700" />}>
                <div className="space-y-4">{Object.entries(workflowsByCategory).map(([cat, group]) => (
                  <div key={cat}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{WORKFLOW_CATEGORY_LABEL[cat] ?? cat}</p>
                    <ul className="mt-1.5 space-y-1.5">{group.map((w) => (
                      <li key={w.id} className="rounded-md border border-slate-200 p-2.5 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          {w.code && <span className="font-mono text-xs font-semibold text-pink-700">{w.code}</span>}
                          <span className="font-medium text-slate-800">{w.name}</span>
                          {w.patient_facing && <Badge className="bg-violet-50 text-violet-700">Patient-facing</Badge>}
                          <ProvBadge inferred={w.inferred} confidence={w.confidence} />
                        </div>
                        {w.trigger && <p className="mt-0.5 text-xs text-slate-500"><span className="font-semibold">Trigger:</span> {w.trigger}</p>}
                        {w.what_it_does && <p className="mt-0.5 text-xs text-slate-600">{w.what_it_does}</p>}
                      </li>
                    ))}</ul>
                  </div>
                ))}</div>
              </Panel>
            )}

            {(customFields.length > 0 || tags.length > 0) && (
              <Panel title="Custom fields, values & tags" icon={<Tag className="h-4 w-4 text-pink-700" />}>
                <div className="space-y-3 text-sm">
                  {(["FIELD", "VALUE"] as const).map((kind) => {
                    const group = customFields.filter((f) => f.kind === kind);
                    if (group.length === 0) return null;
                    return (
                      <div key={kind}>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{kind === "FIELD" ? "Custom fields" : "Custom values"}</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">{group.map((f) => (
                          <span key={f.id} title={f.description} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-xs ${f.populated ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"}`}>
                            {f.key}{!f.populated && <span className="not-italic">· needs value</span>}
                          </span>
                        ))}</div>
                      </div>
                    );
                  })}
                  {tags.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tag glossary</p>
                      <ul className="mt-1 space-y-0.5 text-slate-600">{tags.map((t) => (
                        <li key={t.id}><code className="rounded bg-slate-100 px-1 text-xs">{t.tag}</code>{t.meaning ? ` — ${t.meaning}` : ""}</li>
                      ))}</ul>
                    </div>
                  )}
                </div>
              </Panel>
            )}

            {preLaunch.length > 0 && (
              <Panel title="Pre-launch checklist" icon={<ListChecks className="h-4 w-4 text-pink-700" />}>
                <ul className="space-y-1.5">{preLaunch.map((item) => (
                  <li key={item.id} className="flex items-start gap-2 text-sm">
                    <form action={togglePreLaunchItem} className="mt-0.5">
                      <input type="hidden" name="id" value={item.id} />
                      <input type="hidden" name="buildId" value={id} />
                      <input type="hidden" name="done" value={(!item.done).toString()} />
                      <button type="submit" aria-label={item.done ? "Mark not done" : "Mark done"}
                        className={`flex h-4 w-4 items-center justify-center rounded border ${item.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 bg-white"}`}>
                        {item.done && <span className="text-[10px] leading-none">✓</span>}
                      </button>
                    </form>
                    <span className={item.done ? "text-slate-400 line-through" : "text-slate-700"}>
                      {item.description}{item.optional && <span className="ml-1 text-xs text-slate-400">(optional)</span>}
                    </span>
                  </li>
                ))}</ul>
              </Panel>
            )}
          </TabPanel>
        )}

        {/* ── Edit (admin) ─────────────────────────────────────────── */}
        {canManageBuilds && hasBlueprint && (
          <TabPanel id="edit" label="Edit blueprint">
            <Panel title="Edit blueprint" icon={<Sparkles className="h-4 w-4 text-pink-700" />}>
              <BlueprintEditor
                buildId={id}
                stageOptions={stages.map((s) => ({ value: String(s.id), label: s.name }))}
                sections={[
                  { resource: "stage", label: "Pipeline stages", items: stages },
                  { resource: "transition", label: "Stage movement", items: transitions },
                  { resource: "leadsource", label: "Lead sources", items: contactSources },
                  { resource: "calendar", label: "Calendars", items: calendars },
                  { resource: "integration", label: "Integrations", items: integrationLinks },
                  { resource: "workflow", label: "Workflows", items: workflows },
                  { resource: "customfield", label: "Custom fields & values", items: customFields },
                  { resource: "tag", label: "Tags", items: tags },
                  { resource: "prelaunch", label: "Pre-launch checklist", items: preLaunch },
                  { resource: "task", label: "Tasks", items: tasks },
                ]}
              />
            </Panel>
          </TabPanel>
        )}

        {/* ── Gaps & QA ────────────────────────────────────────────── */}
        {(gaps.length > 0 || latestQa) && (
          <TabPanel id="gaps" label="Gaps & QA" count={openGaps.length}>
            {(openGaps.length > 0 || resolvedGaps.length > 0) && (
              <Panel
                title={`Vision gaps${openGaps.length ? ` (${openGaps.length} open)` : ""}`}
                icon={<HelpCircle className="h-4 w-4 text-pink-700" />}
                action={canManageBuilds && hasBlueprint && (
                  <GenerateBriefButton buildId={id} hasBrief label="Apply answers & refine" />
                )}
              >
                {openGaps.length === 0 ? (
                  <p className="text-sm text-emerald-700">All flagged gaps resolved — the vision is fully pinned down.</p>
                ) : (
                  <ul className="space-y-3">{openGaps.map((g) => (
                    <GapResolver key={g.id} gap={g} buildId={id} />
                  ))}</ul>
                )}
                {resolvedGaps.length > 0 && (
                  <details className="mt-3 border-t border-slate-100 pt-3">
                    <summary className="cursor-pointer text-xs font-semibold text-slate-500">Resolved ({resolvedGaps.length})</summary>
                    <ul className="mt-2 space-y-1.5">{resolvedGaps.map((g) => (
                      <li key={g.id} className="flex items-start justify-between gap-2 text-xs text-slate-600">
                        <span>
                          <span className={`mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${g.status === "ANSWERED" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{g.status}</span>
                          {g.question}{g.answer ? ` — ${g.answer}` : ""}
                        </span>
                        {canManageBuilds && (
                          <ConfirmDeleteButton action={deleteGap} fields={{ id: g.id, buildId: id }}
                            title="Delete gap" message="Permanently delete this gap?" />
                        )}
                      </li>
                    ))}</ul>
                  </details>
                )}
              </Panel>
            )}

            {latestQa && (
              <Panel title="AI QA review" icon={<ShieldCheck className="h-4 w-4 text-pink-700" />}>
                <p className="text-sm text-slate-700">{latestQa.summary.replace(/^AI QA:\s*/, "")}</p>
                {latestQa.scope_changes && (
                  <pre className="mt-3 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">{latestQa.scope_changes}</pre>
                )}
                <p className="mt-2 text-xs text-slate-400">{formatDate(latestQa.created_at)}</p>
              </Panel>
            )}
          </TabPanel>
        )}

        {/* ── Tasks ────────────────────────────────────────────────── */}
        <TabPanel id="tasks" label="Tasks" count={tasks.length}>
          <Panel title="Tasks" icon={<FileText className="h-4 w-4 text-pink-700" />}>
            {tasks.length === 0 ? <p className="text-sm text-slate-500">No tasks yet.</p> : (
              <ul className="divide-y divide-slate-100">
                {tasks.map((t) => (
                  <li key={t.id} className="py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0"><p className="text-sm font-medium text-slate-900">{t.title}</p><p className="text-xs text-slate-400">{t.type}</p></div>
                      <div className="flex items-center gap-2">
                        {canManageBuilds && <GenerateSopButton buildId={id} taskId={t.id} hasDescription={Boolean(t.description)} />}
                        {canManage ? (
                          <form action={updateTaskStatus} className="flex items-center gap-2">
                            <input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="buildId" value={id} />
                            <Select name="status" defaultValue={t.status} className="h-8 text-xs">{TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}</Select>
                            <Button type="submit" size="sm" variant="outline">Set</Button>
                          </form>
                        ) : (
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{TASK_STATUS_LABEL[t.status]}</span>
                        )}
                        {canManage && (
                          <ConfirmDeleteButton action={deleteTask} fields={{ taskId: t.id, buildId: id }}
                            title="Delete task" message={`Delete task "${t.title}"?`} />
                        )}
                      </div>
                    </div>
                    {t.description && (
                      <div className="mt-2 rounded-md bg-slate-50 p-3 text-xs leading-relaxed whitespace-pre-wrap text-slate-700">{t.description}</div>
                    )}
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
