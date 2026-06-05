import { notFound } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { ArrowLeft, Bot, Download, FileText, Link2, Trash2 } from "lucide-react";
import type { TaskStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { notify, logActivity } from "@/lib/notify";
import {
  addMeetingNote,
  addTaskDependency,
  assignBuild,
  createChangeRequest,
  createTask,
  enableClientPortal,
  recordApproval,
  removeTaskDependency,
  setBuildStatus,
  setChangeRequestStatus,
  updateTaskStatus,
} from "../actions";
import { deleteDocument } from "../document-actions";
import { DocumentUploader } from "@/components/document-uploader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { formatBytes, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function BuildDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";

  const build = await prisma.build.findUnique({
    where: { id },
    include: {
      client: true,
      assignee: true,
      creator: true,
      contactSources: true,
      stages: { include: { manualActions: true }, orderBy: { order: "asc" } },
      tasks: {
        orderBy: { createdAt: "asc" },
        include: {
          assignee: true,
          blockedBy: { include: { blocker: true } },
          blocks: { include: { blocked: true } },
          documents: { include: { uploadedBy: true }, orderBy: { createdAt: "desc" } },
        },
      },
      documents: { include: { uploadedBy: true }, orderBy: { createdAt: "desc" } },
      comments: { include: { author: true }, orderBy: { createdAt: "asc" } },
      activities: { orderBy: { createdAt: "desc" }, take: 20 },
      meetingNotes: { orderBy: { createdAt: "desc" } },
      changeRequests: { include: { owner: true, createdBy: true }, orderBy: { createdAt: "desc" } },
      approvals: { include: { approver: true }, orderBy: { createdAt: "desc" } },
      memorySnapshots: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!build) notFound();
  if (!isAdmin && build.assigneeId !== user.id) notFound();

  const members = isAdmin
    ? await prisma.user.findMany({ where: { role: "MEMBER", active: true } })
    : [];

  async function doAssign(formData: FormData) {
    "use server";
    const assigneeId = String(formData.get("assigneeId") ?? "");
    if (assigneeId) await assignBuild(id, assigneeId);
  }
  async function doStatus(formData: FormData) {
    "use server";
    await setBuildStatus(id, String(formData.get("status")) as never);
  }
  async function doCreateTask(formData: FormData) {
    "use server";
    await createTask(id, formData);
  }
  async function doTaskStatus(formData: FormData) {
    "use server";
    await updateTaskStatus(
      String(formData.get("taskId")),
      String(formData.get("status")) as TaskStatus,
      String(formData.get("progressNote") ?? ""),
    );
  }
  async function doDeleteDocument(formData: FormData) {
    "use server";
    await deleteDocument(String(formData.get("documentId")), id);
  }
  async function doComment(formData: FormData) {
    "use server";
    const u = await requireUser();
    const body = String(formData.get("body") ?? "").trim();
    if (!body) return;
    await prisma.comment.create({ data: { buildId: id, authorId: u.id, body } });
    await logActivity(id, u.name, "commented");
    const other = u.id === build!.creatorId ? build!.assigneeId : build!.creatorId;
    if (other) {
      await notify({ userId: other, type: "COMMENT", message: `New comment on ${build!.title}`, link: `/builds/${id}` });
    }
    revalidatePath(`/builds/${id}`);
  }
  async function doMeetingNote(formData: FormData) {
    "use server";
    await addMeetingNote(id, formData);
  }
  async function doChangeRequest(formData: FormData) {
    "use server";
    await createChangeRequest(id, formData);
  }
  async function doChangeStatus(formData: FormData) {
    "use server";
    await setChangeRequestStatus(id, formData);
  }
  async function doApproval(formData: FormData) {
    "use server";
    await recordApproval(id, formData);
  }
  async function doEnablePortal() {
    "use server";
    await enableClientPortal(id);
  }
  async function doAddDependency(formData: FormData) {
    "use server";
    await addTaskDependency(id, formData);
  }
  async function doRemoveDependency(formData: FormData) {
    "use server";
    await removeTaskDependency(id, formData);
  }

  const portalUrl =
    build.clientPortalEnabled && build.clientPortalToken
      ? `${process.env.APP_URL ?? "http://localhost:3000"}/portal/${build.clientPortalToken}`
      : null;

  return (
    <div className="space-y-5">
      {/* Back nav */}
      <Link
        href="/builds"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors hover:text-slate-950"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to builds
      </Link>

      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-white/80 bg-white/85 p-5 shadow-sm shadow-slate-900/[0.04] backdrop-blur">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
            Build workspace
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{build.title}</h1>
            <StatusBadge status={build.status} />
          </div>
          <p className="text-sm text-slate-500">
            {build.client.name} - Created by {build.creator.name} - {formatDate(build.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {build.meetingNotes.length > 0 && (
            <Link href={`/builds/${id}/review`}>
              <Button variant="outline" size="sm">
                <Bot className="h-3.5 w-3.5" />
                AI brief / notes
              </Button>
            </Link>
          )}
          {!isAdmin && build.status !== "DELIVERED" && (
            <form action={doStatus}>
              <input type="hidden" name="status" value="READY_FOR_REVIEW" />
              <Button size="sm">Mark ready for review</Button>
            </form>
          )}
          {isAdmin && build.status === "READY_FOR_REVIEW" && (
            <>
              <form action={doStatus}>
                <input type="hidden" name="status" value="DELIVERED" />
                <Button size="sm" variant="success">Approve & deliver</Button>
              </form>
              <form action={doStatus}>
                <input type="hidden" name="status" value="CHANGES_REQUESTED" />
                <Button size="sm" variant="outline">Request changes</Button>
              </form>
            </>
          )}
        </div>
      </div>

      {/* Main grid */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Left column */}
        <div className="space-y-5 lg:col-span-2">
          {/* Brief */}
          <Card>
            <CardHeader>
              <CardTitle>Brief</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 text-sm">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Goals</p>
                  <p className="text-slate-700">{build.goals ?? "-"}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Integrations</p>
                  <p className="text-slate-700">{build.integrations ?? "-"}</p>
                </div>
              </div>

              {build.contactSources.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Contact sources</p>
                  <div className="flex flex-wrap gap-1.5">
                    {build.contactSources.map((source) => (
                      <Badge key={source.id} className="bg-slate-100 text-slate-700">
                        {source.type}: {source.label}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {build.stages.length > 0 && (
                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Pipeline stages</p>
                  <ol className="space-y-2.5">
                    {build.stages.map((stage) => (
                      <li key={stage.id} className="flex gap-3">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-[10px] font-bold text-cyan-700 ring-1 ring-cyan-100">
                          {stage.order}
                        </span>
                        <div className="flex-1 rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-slate-950">{stage.name}</span>
                            {stage.needsManual && (
                              <Badge className="bg-orange-50 text-orange-700">manual</Badge>
                            )}
                          </div>
                          {stage.description && (
                            <p className="mt-1 text-slate-600">{stage.description}</p>
                          )}
                          {stage.manualActions.map((action) => (
                            <p key={action.id} className="mt-1 text-xs text-slate-500">
                              - {action.description}
                              {action.owner ? ` (${action.owner})` : ""}
                            </p>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tasks */}
          <Card>
            <CardHeader>
              <CardTitle>
                Tasks{" "}
                <span className="ml-1.5 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-500">
                  {build.tasks.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {build.tasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/[0.02]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-950">{task.title}</span>
                      <Badge className="bg-slate-100 text-slate-600">{task.type}</Badge>
                      {task.aiGenerated && (
                        <Badge className="bg-violet-50 text-violet-700">
                          <Bot className="mr-1 h-2.5 w-2.5" />
                          AI
                        </Badge>
                      )}
                      <StatusBadge status={task.status} kind="task" />
                    </div>
                  </div>

                  {task.blockedBy.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {task.blockedBy.map((dependency) => (
                        <Badge key={dependency.id} className="bg-amber-50 text-amber-700">
                          waits for {dependency.blocker.title}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {task.description && (
                    <p className="mt-1.5 text-xs text-slate-500">{task.description}</p>
                  )}
                  {task.progressNote && (
                    <p className="mt-1 rounded-md bg-white px-2.5 py-1.5 text-xs text-slate-600 ring-1 ring-slate-200">
                      {task.progressNote}
                    </p>
                  )}

                  <form action={doTaskStatus} className="mt-3 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="taskId" value={task.id} />
                    <Select name="status" defaultValue={task.status} className="h-8 w-36 text-xs">
                      {["TODO", "IN_PROGRESS", "BLOCKED", "DONE"].map((s) => (
                        <option key={s} value={s}>
                          {s.replace(/_/g, " ")}
                        </option>
                      ))}
                    </Select>
                    <Input
                      name="progressNote"
                      placeholder="Progress note"
                      className="h-8 min-w-40 flex-1 text-xs"
                    />
                    <Button size="sm" variant="outline">
                      Update
                    </Button>
                  </form>

                  {/* Task attachments */}
                  <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Attachments
                      </p>
                      <span className="text-[10px] text-slate-400">{task.documents.length}</span>
                    </div>
                    {task.documents.length > 0 && (
                      <ul className="mb-3 space-y-1.5">
                        {task.documents.map((doc) => (
                          <li
                            key={doc.id}
                            className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs"
                          >
                            <a
                              href={doc.url}
                              target="_blank"
                              rel="noreferrer"
                              className="flex min-w-0 items-center gap-1.5 font-semibold text-slate-700 hover:text-cyan-700"
                            >
                              <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                              <span className="truncate">{doc.filename}</span>
                              {doc.aiReadable && (
                                <Badge className="ml-1 bg-emerald-50 text-emerald-700">AI-readable</Badge>
                              )}
                            </a>
                            <div className="flex items-center gap-1.5 text-slate-400">
                              <span>{formatBytes(doc.sizeBytes)}</span>
                              <form action={doDeleteDocument}>
                                <input type="hidden" name="documentId" value={doc.id} />
                                <button
                                  className="rounded p-0.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                                  aria-label={`Delete ${doc.filename}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </form>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                    <DocumentUploader taskId={task.id} compact />
                  </div>
                </div>
              ))}

              {build.tasks.length === 0 && (
                <p className="py-3 text-sm text-slate-500">No tasks yet.</p>
              )}

              {/* Add task form */}
              <form
                action={doCreateTask}
                className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4"
              >
                <Input
                  name="title"
                  placeholder="New task title"
                  className="min-w-40 flex-1"
                  required
                />
                <Select name="type" defaultValue="OTHER" className="w-36">
                  {["AUTOMATION", "FUNNEL", "FORM", "INTEGRATION", "OTHER"].map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </Select>
                <Button size="md">Add task</Button>
              </form>
            </CardContent>
          </Card>

          {/* Documents */}
          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <DocumentUploader buildId={id} />
              {build.documents.length > 0 ? (
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-100 bg-slate-50/80">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                          File
                        </th>
                        <th className="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 sm:table-cell">
                          Uploaded by
                        </th>
                        <th className="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 md:table-cell">
                          Size
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {build.documents.map((doc) => (
                        <tr key={doc.id} className="hover:bg-cyan-50/30">
                          <td className="px-4 py-3">
                            <a
                              href={doc.url}
                              target="_blank"
                              rel="noreferrer"
                              className="flex min-w-0 items-center gap-2 font-semibold text-slate-950 hover:text-cyan-700"
                            >
                              <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                              <span className="truncate">{doc.filename}</span>
                              {doc.aiReadable && (
                                <Badge className="ml-1 bg-emerald-50 text-emerald-700">AI-readable</Badge>
                              )}
                            </a>
                            <p className="mt-0.5 text-xs text-slate-400 sm:hidden">
                              {doc.uploadedBy.name} - {formatBytes(doc.sizeBytes)}
                            </p>
                          </td>
                          <td className="hidden px-4 py-3 text-slate-500 sm:table-cell">
                            {doc.uploadedBy.name}
                          </td>
                          <td className="hidden px-4 py-3 text-slate-500 md:table-cell">
                            {formatBytes(doc.sizeBytes)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-1">
                              <a
                                href={doc.url}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-cyan-50 hover:text-cyan-700"
                                aria-label={`Open ${doc.filename}`}
                              >
                                <Download className="h-4 w-4" />
                              </a>
                              <form action={doDeleteDocument}>
                                <input type="hidden" name="documentId" value={doc.id} />
                                <button
                                  className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                                  aria-label={`Delete ${doc.filename}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </form>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  No documents uploaded yet.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Comments */}
          <Card>
            <CardHeader>
              <CardTitle>
                Comments{" "}
                <span className="ml-1.5 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-500">
                  {build.comments.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {build.comments.length > 0 ? (
                <ul className="space-y-3">
                  {build.comments.map((comment) => {
                    const initials = comment.author.name
                      .split(" ")
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase();
                    return (
                      <li key={comment.id} className="flex gap-3">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-[10px] font-semibold text-cyan-700 ring-1 ring-cyan-100">
                          {initials}
                        </span>
                        <div className="flex-1 rounded-lg bg-slate-50 px-3.5 py-3 text-sm">
                          <div className="flex items-baseline gap-2">
                            <span className="font-semibold text-slate-950">{comment.author.name}</span>
                            <span className="text-xs text-slate-400">{formatDate(comment.createdAt)}</span>
                          </div>
                          <p className="mt-1 text-slate-600">{comment.body}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">No comments yet.</p>
              )}

              <form action={doComment} className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-end">
                <Textarea
                  name="body"
                  placeholder="Add a comment"
                  rows={2}
                  className="flex-1"
                />
                <Button size="md" className="shrink-0">
                  Post
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Right sidebar */}
        <div className="space-y-5">
          {/* Assignment */}
          <Card>
            <CardHeader>
              <CardTitle>Assignment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
                {build.assignee ? (
                  <>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-xs font-semibold text-cyan-700 ring-1 ring-cyan-100">
                      {build.assignee.name
                        .split(" ")
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </span>
                    <div>
                      <p className="font-semibold text-slate-950">{build.assignee.name}</p>
                      <p className="text-xs text-slate-500">Assignee</p>
                    </div>
                  </>
                ) : (
                  <p className="text-slate-500">Unassigned</p>
                )}
              </div>

              {isAdmin && (
                <form action={doAssign} className="space-y-2">
                  <Label htmlFor="assigneeId">
                    {build.assigneeId ? "Reassign to" : "Assign to"}
                  </Label>
                  <Select id="assigneeId" name="assigneeId" defaultValue={build.assigneeId ?? ""}>
                    <option value="" disabled>
                      Select member
                    </option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </Select>
                  <Button size="sm" className="w-full">
                    {build.assigneeId ? "Reassign" : "Assign"}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Client portal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {portalUrl ? (
                <>
                  <a
                    href={portalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded-lg bg-cyan-50 px-3 py-2 text-xs font-semibold text-cyan-800 ring-1 ring-cyan-100 hover:bg-cyan-100"
                  >
                    <Link2 className="h-4 w-4" />
                    Open client portal
                  </a>
                  <p className="break-all text-xs text-slate-500">{portalUrl}</p>
                </>
              ) : isAdmin ? (
                <form action={doEnablePortal}>
                  <Button size="sm" className="w-full">
                    Enable portal link
                  </Button>
                </form>
              ) : (
                <p className="text-xs text-slate-500">Portal is not enabled.</p>
              )}
            </CardContent>
          </Card>

          {/* Meeting memory */}
          <Card>
            <CardHeader>
              <CardTitle>
                Build memory{" "}
                <span className="ml-1.5 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-500">
                  {build.meetingNotes.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form action={doMeetingNote} className="space-y-2">
                <Label htmlFor="rawText">Follow-up meeting notes</Label>
                <Textarea
                  id="rawText"
                  name="rawText"
                  rows={4}
                  placeholder="Paste client updates, changes, new decisions, or clarifications"
                  required
                />
                <Button size="sm" className="w-full">
                  Save follow-up notes
                </Button>
              </form>

              {build.meetingNotes.length === 0 ? (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  No meeting notes stored yet.
                </p>
              ) : (
                <ol className="space-y-3 border-t border-slate-100 pt-4">
                  {build.meetingNotes.map((note, index) => {
                    const number = build.meetingNotes.length - index;
                    return (
                      <li key={note.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-slate-950">
                            {number === 1 ? "Original meeting" : `Follow-up ${number - 1}`}
                          </p>
                          <span className="text-[10px] text-slate-400">{formatDate(note.createdAt)}</span>
                        </div>
                        <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-slate-600">
                          {note.rawText}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              )}
              {build.meetingNotes.length > 0 && (
                <p className="text-xs leading-5 text-slate-500">
                  AI regeneration reads all notes chronologically, using the first meeting as the baseline and follow-ups as updates.
                </p>
              )}
              {build.memorySnapshots[0] && (
                <div className="rounded-lg bg-cyan-50 px-3 py-3 text-xs leading-5 text-cyan-900 ring-1 ring-cyan-100">
                  <p className="font-semibold">Current memory summary</p>
                  <p className="mt-1 whitespace-pre-wrap">{build.memorySnapshots[0].summary}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                Change requests{" "}
                <span className="ml-1.5 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-500">
                  {build.changeRequests.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form action={doChangeRequest} className="space-y-2">
                <Input name="title" placeholder="Change title" required />
                <Textarea name="description" rows={3} placeholder="What changed and what should happen?" required />
                <Textarea name="impact" rows={2} placeholder="Impact on scope, timing, or dependencies" />
                <Select name="ownerId" defaultValue="">
                  <option value="">No owner</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </Select>
                <Input name="requester" placeholder="Requester, e.g. client or internal" />
                <Button size="sm" className="w-full">Add change request</Button>
              </form>

              {build.changeRequests.length > 0 ? (
                <ul className="space-y-3 border-t border-slate-100 pt-4">
                  {build.changeRequests.map((change) => (
                    <li key={change.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-950">{change.title}</p>
                          <p className="mt-1 text-xs text-slate-600">{change.description}</p>
                        </div>
                        <Badge className="bg-slate-100 text-slate-700">{change.status}</Badge>
                      </div>
                      {change.impact && <p className="mt-2 text-xs text-slate-500">{change.impact}</p>}
                      {isAdmin && change.status === "PENDING" && (
                        <div className="mt-3 flex gap-2">
                          <form action={doChangeStatus}>
                            <input type="hidden" name="id" value={change.id} />
                            <input type="hidden" name="status" value="APPROVED" />
                            <Button size="sm" variant="success">Approve</Button>
                          </form>
                          <form action={doChangeStatus}>
                            <input type="hidden" name="id" value={change.id} />
                            <input type="hidden" name="status" value="REJECTED" />
                            <Button size="sm" variant="outline">Reject</Button>
                          </form>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">No change requests yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Approvals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isAdmin && (
                <form action={doApproval} className="space-y-2">
                  <Select name="type" defaultValue="BRIEF">
                    <option value="BRIEF">Brief approved</option>
                    <option value="DELIVERY">Delivery approved</option>
                    <option value="CLIENT">Client approved</option>
                  </Select>
                  <Input name="note" placeholder="Approval note" />
                  <Button size="sm" className="w-full">Record approval</Button>
                </form>
              )}
              {build.approvals.length > 0 ? (
                <ul className="space-y-2">
                  {build.approvals.map((approval) => (
                    <li key={approval.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <span className="font-semibold text-slate-950">{approval.type}</span> by {approval.approver.name} - {formatDate(approval.createdAt)}
                      {approval.note && <p className="mt-1">{approval.note}</p>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">No approvals recorded.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Task dependencies</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <form action={doAddDependency} className="space-y-2">
                <Select name="blockerId" defaultValue="">
                  <option value="" disabled>Task that must finish first</option>
                  {build.tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                </Select>
                <Select name="blockedId" defaultValue="">
                  <option value="" disabled>Task waiting on it</option>
                  {build.tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                </Select>
                <Button size="sm" className="w-full">Add dependency</Button>
              </form>
              {build.tasks.flatMap((task) => task.blockedBy).length > 0 ? (
                <ul className="space-y-2">
                  {build.tasks.flatMap((task) =>
                    task.blockedBy.map((dependency) => (
                      <li key={dependency.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        <span><b>{task.title}</b> waits for {dependency.blocker.title}</span>
                        <form action={doRemoveDependency}>
                          <input type="hidden" name="id" value={dependency.id} />
                          <button className="text-slate-400 hover:text-red-600" aria-label="Remove dependency">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </form>
                      </li>
                    )),
                  )}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">No task dependencies yet.</p>
              )}
            </CardContent>
          </Card>

          {/* Activity log */}
          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {build.activities.length === 0 ? (
                <p className="text-xs text-slate-500">No activity yet.</p>
              ) : (
                <ul className="space-y-3">
                  {build.activities.map((activity) => (
                    <li key={activity.id} className="flex gap-2.5 text-xs">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                      <span>
                        <span className="font-medium text-slate-700">{activity.actor}</span>{" "}
                        <span className="text-slate-500">{activity.message}</span>
                        <span className="ml-1.5 text-slate-400">- {formatDate(activity.createdAt)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
