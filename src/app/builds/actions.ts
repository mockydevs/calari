"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth-helpers";
import { extractDocumentText } from "@/lib/document-text";
import { generateBriefFromNotes } from "@/lib/ai";
import { notify, logActivity } from "@/lib/notify";
import { getPublicUrl, uploadObject } from "@/lib/s3";
import { buildCreateSchema } from "@/lib/validations";
import { nanoid } from "@/lib/utils";
import type { BuildStatus, ChangeRequestStatus, TaskStatus, TaskType } from "@prisma/client";

const INTAKE_UPLOAD_LIMIT = 15 * 1024 * 1024;

function storageReady() {
  const required = ["AWS_S3_BUCKET_NAME", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"];
  const missing = required.filter((key) => !process.env[key]);
  return missing.length === 0 ? null : `Storage is not configured: missing ${missing.join(", ")}.`;
}

function getUploadedBriefFile(formData: FormData) {
  const value = formData.get("briefFile");
  return value instanceof File && value.size > 0 ? value : null;
}

function formatNoteHistory(
  notes: { rawText: string; source: string; createdAt: Date; fileUrl: string | null }[],
) {
  return notes
    .map((note, index) => {
      const label = index === 0 ? "Original meeting" : `Follow-up meeting ${index}`;
      const source = note.fileUrl ? `${note.source} file` : note.source;
      return [
        `## ${label}`,
        `Date: ${note.createdAt.toISOString()}`,
        `Source: ${source}`,
        "",
        note.rawText.trim(),
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

async function createMemorySnapshot(buildId: string, createdById?: string) {
  const build = await prisma.build.findUnique({
    where: { id: buildId },
    include: {
      client: true,
      meetingNotes: { orderBy: { createdAt: "asc" } },
      changeRequests: { orderBy: { createdAt: "asc" } },
      tasks: true,
    },
  });
  if (!build) return;

  const latestNote = build.meetingNotes.at(-1);
  const approvedChanges = build.changeRequests.filter((change) => change.status === "APPROVED" || change.status === "IMPLEMENTED");
  const pendingChanges = build.changeRequests.filter((change) => change.status === "PENDING");
  const openTasks = build.tasks.filter((task) => task.status !== "DONE");

  await prisma.buildMemorySnapshot.create({
    data: {
      buildId,
      createdById,
      createdByAi: false,
      summary: [
        `Client: ${build.client.name}`,
        `Current goal: ${build.goals ?? "Not drafted yet"}`,
        `Integrations: ${build.integrations ?? "Not drafted yet"}`,
        `Meetings stored: ${build.meetingNotes.length}`,
        `Open tasks: ${openTasks.length}`,
        latestNote ? `Latest note: ${latestNote.rawText.slice(0, 500)}` : "No meeting notes stored yet",
      ].join("\n"),
      scopeChanges: approvedChanges.length
        ? approvedChanges.map((change) => `- ${change.title}: ${change.description}`).join("\n")
        : "No approved scope changes recorded.",
      openQuestions: pendingChanges.length
        ? pendingChanges.map((change) => `- Pending: ${change.title}`).join("\n")
        : "No pending change requests.",
    },
  });
}

export async function createBuild(formData: FormData) {
  const admin = await requireAdmin();
  const uploadedFile = getUploadedBriefFile(formData);
  const parsed = buildCreateSchema.safeParse({
    title: formData.get("title"),
    clientId: formData.get("clientId"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.errors[0]?.message ?? "Invalid input");
  if (uploadedFile && uploadedFile.size > INTAKE_UPLOAD_LIMIT) {
    throw new Error("Intake file must be 15 MB or smaller");
  }

  const extracted = uploadedFile ? await extractDocumentText(uploadedFile) : null;
  const pastedNotes = parsed.data.notes?.trim();
  const extractedNotes = extracted?.text.trim();
  const combinedNotes = [
    pastedNotes ? `Pasted meeting notes:\n${pastedNotes}` : "",
    extractedNotes ? `Uploaded intake document (${uploadedFile?.name}):\n${extractedNotes}` : "",
    uploadedFile && extracted && !extracted.supported ? `Upload note: ${extracted.reason}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const build = await prisma.build.create({
    data: {
      title: parsed.data.title,
      clientId: parsed.data.clientId,
      creatorId: admin.id,
      status: "DRAFT",
      meetingNotes: combinedNotes
        ? { create: { source: uploadedFile ? "upload" : "paste", rawText: combinedNotes } }
        : undefined,
    },
    include: { meetingNotes: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  if (uploadedFile) {
    const storageError = storageReady();
    if (storageError) throw new Error(storageError);

    const ext = uploadedFile.name.split(".").pop() ?? "bin";
    const key = `uploads/${nanoid()}.${ext}`;
    const contentType = uploadedFile.type || "application/octet-stream";
    const buffer = Buffer.from(await uploadedFile.arrayBuffer());
    await uploadObject(key, buffer, contentType);
    const fileUrl = getPublicUrl(key);

    await prisma.document.create({
      data: {
        filename: uploadedFile.name,
        url: fileUrl,
        mimeType: contentType,
        sizeBytes: uploadedFile.size,
        aiReadable: extracted?.supported ?? false,
        extractedText: extracted?.text || null,
        buildId: build.id,
        uploaderId: admin.id,
      },
    });

    const note = build.meetingNotes[0];
    if (note) {
      await prisma.meetingNote.update({ where: { id: note.id }, data: { fileUrl } });
    }
  }

  await logActivity(build.id, admin.name, "created the build");
  await createMemorySnapshot(build.id, admin.id);
  redirect(`/builds/${build.id}${combinedNotes ? "/review" : ""}`);
}

export async function generateBrief(buildId: string) {
  await requireAdmin();
  const notes = await prisma.meetingNote.findMany({
    where: { buildId },
    orderBy: { createdAt: "asc" },
  });
  if (notes.length === 0) throw new Error("No meeting notes to process");

  const latestNote = notes[notes.length - 1];
  await prisma.meetingNote.update({ where: { id: latestNote.id }, data: { aiStatus: "processing" } });

  try {
    const draft = await generateBriefFromNotes(formatNoteHistory(notes));

    // wipe any prior AI-generated draft so regenerate is clean
    await prisma.$transaction([
      prisma.contactSource.deleteMany({ where: { buildId } }),
      prisma.manualAction.deleteMany({ where: { stage: { buildId } } }),
      prisma.pipelineStage.deleteMany({ where: { buildId } }),
      prisma.task.deleteMany({ where: { buildId, aiGenerated: true } }),
    ]);

    await prisma.build.update({
      where: { id: buildId },
      data: {
        status: "AI_DRAFTED",
        goals: draft.goals,
        integrations: draft.integrations.join(", "),
        contactSources: { create: draft.contactSources.map((s) => ({ type: s.type, label: s.label })) },
        stages: {
          create: draft.pipelineStages.map((st) => ({
            name: st.name,
            description: st.description,
            order: st.order,
            needsManual: st.manualActions.length > 0,
            manualActions: { create: st.manualActions.map((m) => ({ description: m.description, owner: m.owner })) },
          })),
        },
        tasks: {
          create: draft.tasks.map((t) => ({
            title: t.title,
            description: t.description,
            type: t.type as TaskType,
            aiGenerated: true,
          })),
        },
      },
    });
    await prisma.meetingNote.update({
      where: { id: latestNote.id },
      data: { aiStatus: "done", aiOutput: draft as object },
    });
    await createMemorySnapshot(buildId);
  } catch (err) {
    await prisma.meetingNote.update({ where: { id: latestNote.id }, data: { aiStatus: "failed" } });
    throw err;
  }
  revalidatePath(`/builds/${buildId}/review`);
  revalidatePath(`/builds/${buildId}`);
}

export async function addMeetingNote(buildId: string, formData: FormData) {
  const user = await requireUser();
  const body = String(formData.get("rawText") ?? "").trim();
  if (!body) throw new Error("Meeting note is required");

  const build = await prisma.build.findUnique({
    where: { id: buildId },
    include: { creator: true, assignee: true },
  });
  if (!build) throw new Error("Build not found");

  const canAccess = user.role === "ADMIN" || build.creatorId === user.id || build.assigneeId === user.id;
  if (!canAccess) throw new Error("Unauthorized");

  await prisma.meetingNote.create({
    data: {
      buildId,
      source: "follow_up",
      rawText: body,
    },
  });
  await logActivity(buildId, user.name, "added follow-up meeting notes");
  await createMemorySnapshot(buildId, user.id);

  const recipients = [build.creatorId, build.assigneeId].filter(
    (id): id is string => !!id && id !== user.id,
  );
  await Promise.all(
    recipients.map((userId) =>
      notify({
        userId,
        type: "MEETING_NOTE_ADDED",
        message: `Follow-up notes added: ${build.title}`,
        link: `/builds/${buildId}`,
      }),
    ),
  );

  revalidatePath(`/builds/${buildId}`);
  revalidatePath(`/builds/${buildId}/review`);
}

export async function createChangeRequest(buildId: string, formData: FormData) {
  const user = await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const impact = String(formData.get("impact") ?? "").trim();
  const ownerId = String(formData.get("ownerId") ?? "").trim() || null;
  const requester = String(formData.get("requester") ?? "").trim() || null;
  if (!title || !description) throw new Error("Title and description are required");

  const build = await prisma.build.findUnique({ where: { id: buildId } });
  if (!build) throw new Error("Build not found");
  const canAccess = user.role === "ADMIN" || build.creatorId === user.id || build.assigneeId === user.id;
  if (!canAccess) throw new Error("Unauthorized");

  await prisma.changeRequest.create({
    data: {
      buildId,
      title,
      description,
      impact: impact || null,
      ownerId,
      requester,
      createdById: user.id,
    },
  });
  await logActivity(buildId, user.name, `created change request "${title}"`);
  await createMemorySnapshot(buildId, user.id);

  const recipients = [build.creatorId, build.assigneeId].filter(
    (id): id is string => !!id && id !== user.id,
  );
  await Promise.all(
    recipients.map((userId) =>
      notify({
        userId,
        type: "CHANGE_REQUEST",
        message: `Change request added: ${title}`,
        link: `/builds/${buildId}`,
      }),
    ),
  );

  revalidatePath(`/builds/${buildId}`);
}

export async function setChangeRequestStatus(buildId: string, formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "PENDING") as ChangeRequestStatus;
  if (!id) throw new Error("Change request id is required");

  const change = await prisma.changeRequest.update({
    where: { id },
    data: { status },
    include: { build: true },
  });
  if (change.buildId !== buildId) throw new Error("Change request does not belong to build");

  await prisma.approvalRecord.create({
    data: {
      buildId,
      type: "CHANGE_REQUEST",
      approverId: admin.id,
      note: `${status}: ${change.title}`,
    },
  });
  await logActivity(buildId, admin.name, `${status.toLowerCase().replace(/_/g, " ")} change request "${change.title}"`);
  await createMemorySnapshot(buildId, admin.id);
  revalidatePath(`/builds/${buildId}`);
}

export async function recordApproval(buildId: string, formData: FormData) {
  const admin = await requireAdmin();
  const type = String(formData.get("type") ?? "BRIEF") as "BRIEF" | "DELIVERY" | "CLIENT";
  const note = String(formData.get("note") ?? "").trim() || null;

  await prisma.approvalRecord.create({
    data: { buildId, type, note, approverId: admin.id },
  });
  await logActivity(buildId, admin.name, `recorded ${type.toLowerCase().replace(/_/g, " ")} approval`);
  revalidatePath(`/builds/${buildId}`);
}

export async function enableClientPortal(buildId: string) {
  const admin = await requireAdmin();
  const build = await prisma.build.findUnique({ where: { id: buildId } });
  if (!build) throw new Error("Build not found");
  const token = build.clientPortalToken ?? nanoid(32);

  await prisma.build.update({
    where: { id: buildId },
    data: { clientPortalEnabled: true, clientPortalToken: token },
  });
  await logActivity(buildId, admin.name, "enabled client portal");
  revalidatePath(`/builds/${buildId}`);
}

export async function addTaskDependency(buildId: string, formData: FormData) {
  const user = await requireUser();
  const blockerId = String(formData.get("blockerId") ?? "");
  const blockedId = String(formData.get("blockedId") ?? "");
  if (!blockerId || !blockedId || blockerId === blockedId) throw new Error("Choose two different tasks");

  const build = await prisma.build.findUnique({ where: { id: buildId } });
  if (!build) throw new Error("Build not found");
  const canAccess = user.role === "ADMIN" || build.creatorId === user.id || build.assigneeId === user.id;
  if (!canAccess) throw new Error("Unauthorized");

  const tasks = await prisma.task.findMany({ where: { id: { in: [blockerId, blockedId] }, buildId } });
  if (tasks.length !== 2) throw new Error("Both tasks must belong to this build");

  await prisma.taskDependency.upsert({
    where: { blockerId_blockedId: { blockerId, blockedId } },
    update: {},
    create: { blockerId, blockedId },
  });
  await logActivity(buildId, user.name, "added a task dependency");
  revalidatePath(`/builds/${buildId}`);
}

export async function removeTaskDependency(buildId: string, formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Dependency id is required");

  const dependency = await prisma.taskDependency.findUnique({
    where: { id },
    include: { blocker: { select: { buildId: true } }, blocked: { select: { buildId: true } } },
  });
  if (!dependency || dependency.blocker.buildId !== buildId || dependency.blocked.buildId !== buildId) {
    throw new Error("Dependency not found");
  }

  const build = await prisma.build.findUnique({ where: { id: buildId } });
  if (!build) throw new Error("Build not found");
  const canAccess = user.role === "ADMIN" || build.creatorId === user.id || build.assigneeId === user.id;
  if (!canAccess) throw new Error("Unauthorized");

  await prisma.taskDependency.delete({ where: { id } });
  revalidatePath(`/builds/${buildId}`);
}

export async function assignBuild(buildId: string, assigneeId: string) {
  const admin = await requireAdmin();
  const build = await prisma.build.update({
    where: { id: buildId },
    data: { assigneeId, status: "ASSIGNED" },
    include: { client: true },
  });
  await logActivity(buildId, admin.name, "assigned the build");
  await notify({
    userId: assigneeId,
    type: "BUILD_ASSIGNED",
    message: `New build assigned: ${build.title}`,
    link: `/builds/${buildId}`,
  });
  revalidatePath(`/builds/${buildId}`);
  redirect(`/builds/${buildId}`);
}

export async function setBuildStatus(buildId: string, status: BuildStatus) {
  const user = await requireUser();
  const build = await prisma.build.update({ where: { id: buildId }, data: { status }, include: { creator: true, assignee: true } });
  await logActivity(buildId, user.name, `set status to ${status.replace(/_/g, " ")}`);
  if (status === "READY_FOR_REVIEW") {
    await notify({ userId: build.creatorId, type: "READY_FOR_REVIEW", message: `Build ready for review: ${build.title}`, link: `/builds/${buildId}` });
  }
  if (status === "CHANGES_REQUESTED" && build.assigneeId) {
    await notify({ userId: build.assigneeId, type: "CHANGES_REQUESTED", message: `Changes requested: ${build.title}`, link: `/builds/${buildId}` });
  }
  revalidatePath(`/builds/${buildId}`);
}

export async function createTask(buildId: string, formData: FormData) {
  const user = await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("Title required");
  const build = await prisma.build.findUnique({ where: { id: buildId } });
  await prisma.task.create({
    data: {
      buildId,
      title,
      type: (String(formData.get("type") ?? "OTHER")) as TaskType,
      description: String(formData.get("description") ?? "") || null,
      assigneeId: build?.assigneeId ?? null,
    },
  });
  await logActivity(buildId, user.name, `added task "${title}"`);
  revalidatePath(`/builds/${buildId}`);
}

export async function updateTaskStatus(taskId: string, status: TaskStatus, progressNote?: string) {
  const user = await requireUser();
  const task = await prisma.task.update({
    where: { id: taskId },
    data: { status, progressNote: progressNote || undefined },
    include: { build: { include: { creator: true } } },
  });
  await logActivity(task.buildId, user.name, `updated task "${task.title}" to ${status.replace(/_/g, " ")}`);
  await notify({
    userId: task.build.creatorId,
    type: "TASK_UPDATED",
    message: `Task "${task.title}" -> ${status.replace(/_/g, " ")} on ${task.build.title}`,
    link: `/builds/${task.buildId}`,
  });
  revalidatePath(`/builds/${task.buildId}`);
}
