import { notFound } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { Download, FileText, Trash2 } from "lucide-react";
import type { TaskStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { notify, logActivity } from "@/lib/notify";
import { assignBuild, setBuildStatus, createTask, updateTaskStatus } from "../actions";
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
          documents: { include: { uploadedBy: true }, orderBy: { createdAt: "desc" } },
        },
      },
      documents: { include: { uploadedBy: true }, orderBy: { createdAt: "desc" } },
      comments: { include: { author: true }, orderBy: { createdAt: "asc" } },
      activities: { orderBy: { createdAt: "desc" }, take: 20 },
      meetingNotes: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!build) notFound();
  if (!isAdmin && build.assigneeId !== user.id) notFound();

  const members = isAdmin ? await prisma.user.findMany({ where: { role: "MEMBER", active: true } }) : [];

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-950">{build.title}</h1>
            <StatusBadge status={build.status} />
          </div>
          <p className="text-sm text-slate-500">
            {build.client.name} - created by {build.creator.name} - {formatDate(build.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {build.meetingNotes.length > 0 ? (
            <Link href={`/builds/${id}/review`}>
              <Button variant="outline" size="sm">AI brief / notes</Button>
            </Link>
          ) : null}
          {!isAdmin && build.status !== "DELIVERED" ? (
            <form action={doStatus}>
              <input type="hidden" name="status" value="READY_FOR_REVIEW" />
              <Button size="sm">Mark ready for review</Button>
            </form>
          ) : null}
          {isAdmin && build.status === "READY_FOR_REVIEW" ? (
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
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Brief</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <span className="font-medium">Goals: </span>
                <span className="text-slate-600">{build.goals ?? "-"}</span>
              </div>
              <div>
                <span className="font-medium">Integrations: </span>
                <span className="text-slate-600">{build.integrations ?? "-"}</span>
              </div>
              <div>
                <p className="font-medium">Contact sources</p>
                {build.contactSources.length === 0 ? (
                  <p className="text-slate-500">-</p>
                ) : (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {build.contactSources.map((source) => (
                      <Badge key={source.id} className="bg-slate-100 text-slate-700">{source.type}: {source.label}</Badge>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <p className="font-medium">Pipeline</p>
                <ol className="mt-2 space-y-2">
                  {build.stages.map((stage) => (
                    <li key={stage.id} className="rounded-md border border-slate-200 p-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{stage.order}. {stage.name}</span>
                        {stage.needsManual ? <Badge className="bg-orange-100 text-orange-700">manual</Badge> : null}
                      </div>
                      {stage.description ? <p className="mt-1 text-slate-600">{stage.description}</p> : null}
                      {stage.manualActions.map((action) => (
                        <p key={action.id} className="mt-1 text-xs text-slate-500">
                          -&gt; {action.description}{action.owner ? ` (${action.owner})` : ""}
                        </p>
                      ))}
                    </li>
                  ))}
                  {build.stages.length === 0 ? <p className="text-slate-500">No stages yet.</p> : null}
                </ol>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Tasks</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {build.tasks.map((task) => (
                <div key={task.id} className="rounded-md border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{task.title}</span>
                      <Badge className="bg-slate-100 text-slate-600">{task.type}</Badge>
                      {task.aiGenerated ? <Badge className="bg-violet-100 text-violet-700">AI</Badge> : null}
                      <StatusBadge status={task.status} kind="task" />
                    </div>
                  </div>
                  {task.description ? <p className="mt-1 text-xs text-slate-500">{task.description}</p> : null}
                  {task.progressNote ? <p className="mt-1 text-xs text-slate-600">Note: {task.progressNote}</p> : null}
                  <form action={doTaskStatus} className="mt-2 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="taskId" value={task.id} />
                    <Select name="status" defaultValue={task.status} className="h-8 w-36 text-xs">
                      {["TODO", "IN_PROGRESS", "BLOCKED", "DONE"].map((status) => (
                        <option key={status} value={status}>{status.replace(/_/g, " ")}</option>
                      ))}
                    </Select>
                    <Input name="progressNote" placeholder="Progress note" className="h-8 min-w-52 flex-1 text-xs" />
                    <Button size="sm" variant="outline">Update</Button>
                  </form>

                  <div className="mt-3 rounded-md bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase text-slate-500">Attachments</p>
                      <span className="text-xs text-slate-400">{task.documents.length}</span>
                    </div>
                    {task.documents.length > 0 ? (
                      <ul className="mt-2 space-y-2">
                        {task.documents.map((doc) => (
                          <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white px-3 py-2 text-xs ring-1 ring-slate-200">
                            <a href={doc.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 font-medium text-slate-800 hover:text-blue-700">
                              <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                              <span className="truncate">{doc.filename}</span>
                            </a>
                            <div className="flex items-center gap-2 text-slate-500">
                              <span>{formatBytes(doc.sizeBytes)}</span>
                              <form action={doDeleteDocument}>
                                <input type="hidden" name="documentId" value={doc.id} />
                                <button className="rounded p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-700" aria-label={`Delete ${doc.filename}`}>
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </form>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">No task files yet.</p>
                    )}
                    <div className="mt-3">
                      <DocumentUploader taskId={task.id} compact />
                    </div>
                  </div>
                </div>
              ))}
              {build.tasks.length === 0 ? <p className="text-sm text-slate-500">No tasks yet.</p> : null}
              <form action={doCreateTask} className="mt-2 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
                <Input name="title" placeholder="New task title" className="h-9 min-w-52 flex-1" required />
                <Select name="type" defaultValue="OTHER" className="h-9 w-36">
                  {["AUTOMATION", "FUNNEL", "FORM", "INTEGRATION", "OTHER"].map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </Select>
                <Button size="sm">Add task</Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Documents</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <DocumentUploader buildId={id} />
              {build.documents.length > 0 ? (
                <div className="overflow-hidden rounded-md border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-semibold">File</th>
                        <th className="hidden px-4 py-3 font-semibold sm:table-cell">Uploaded by</th>
                        <th className="hidden px-4 py-3 font-semibold md:table-cell">Size</th>
                        <th className="px-4 py-3 text-right font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {build.documents.map((doc) => (
                        <tr key={doc.id} className="bg-white">
                          <td className="min-w-0 px-4 py-3">
                            <a href={doc.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 font-medium text-slate-900 hover:text-blue-700">
                              <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                              <span className="truncate">{doc.filename}</span>
                            </a>
                            <p className="mt-1 text-xs text-slate-500 sm:hidden">{doc.uploadedBy.name} - {formatBytes(doc.sizeBytes)}</p>
                          </td>
                          <td className="hidden px-4 py-3 text-slate-600 sm:table-cell">{doc.uploadedBy.name}</td>
                          <td className="hidden px-4 py-3 text-slate-600 md:table-cell">{formatBytes(doc.sizeBytes)}</td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-1">
                              <a href={doc.url} target="_blank" rel="noreferrer" className="rounded-md p-2 text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-700" aria-label={`Open ${doc.filename}`}>
                                <Download className="h-4 w-4" />
                              </a>
                              <form action={doDeleteDocument}>
                                <input type="hidden" name="documentId" value={doc.id} />
                                <button className="rounded-md p-2 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-700" aria-label={`Delete ${doc.filename}`}>
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
                <p className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-500">No build documents uploaded yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Comments</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {build.comments.map((comment) => (
                <div key={comment.id} className="rounded-md bg-slate-50 px-3 py-2 text-sm">
                  <span className="font-medium">{comment.author.name}</span>{" "}
                  <span className="text-xs text-slate-400">{formatDate(comment.createdAt)}</span>
                  <p className="mt-1 text-slate-600">{comment.body}</p>
                </div>
              ))}
              {build.comments.length === 0 ? <p className="text-sm text-slate-500">No comments yet.</p> : null}
              <form action={doComment} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
                <Textarea name="body" placeholder="Add a comment..." rows={2} className="min-w-60 flex-1" />
                <Button size="sm">Post</Button>
              </form>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Assignment</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>Assignee: <span className="font-medium">{build.assignee?.name ?? "Unassigned"}</span></p>
              {isAdmin ? (
                <form action={doAssign} className="space-y-2">
                  <Label htmlFor="assigneeId">{build.assigneeId ? "Reassign to" : "Assign to"}</Label>
                  <Select id="assigneeId" name="assigneeId" defaultValue={build.assigneeId ?? ""}>
                    <option value="" disabled>Select member...</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>{member.name}</option>
                    ))}
                  </Select>
                  <Button size="sm" className="w-full">{build.assigneeId ? "Reassign" : "Assign"}</Button>
                </form>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-2 text-xs text-slate-500">
                {build.activities.map((activity) => (
                  <li key={activity.id}>
                    <span className="text-slate-700">{activity.actor}</span> {activity.message} - {formatDate(activity.createdAt)}
                  </li>
                ))}
                {build.activities.length === 0 ? <li>No activity yet.</li> : null}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
