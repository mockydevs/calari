"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth-helpers";
import { generateBriefFromNotes } from "@/lib/ai";
import { notify, logActivity } from "@/lib/notify";
import { buildCreateSchema } from "@/lib/validations";
import type { BuildStatus, TaskStatus, TaskType } from "@prisma/client";

export async function createBuild(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = buildCreateSchema.safeParse({
    title: formData.get("title"),
    clientId: formData.get("clientId"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.errors[0]?.message ?? "Invalid input");

  const build = await prisma.build.create({
    data: {
      title: parsed.data.title,
      clientId: parsed.data.clientId,
      creatorId: admin.id,
      status: "DRAFT",
      meetingNotes: parsed.data.notes
        ? { create: { source: "paste", rawText: parsed.data.notes } }
        : undefined,
    },
  });
  await logActivity(build.id, admin.name, "created the build");
  redirect(`/builds/${build.id}${parsed.data.notes ? "/review" : ""}`);
}

export async function generateBrief(buildId: string) {
  await requireAdmin();
  const note = await prisma.meetingNote.findFirst({
    where: { buildId },
    orderBy: { createdAt: "desc" },
  });
  if (!note) throw new Error("No meeting notes to process");

  await prisma.meetingNote.update({ where: { id: note.id }, data: { aiStatus: "processing" } });

  try {
    const draft = await generateBriefFromNotes(note.rawText);

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
      where: { id: note.id },
      data: { aiStatus: "done", aiOutput: draft as object },
    });
  } catch (err) {
    await prisma.meetingNote.update({ where: { id: note.id }, data: { aiStatus: "failed" } });
    throw err;
  }
  revalidatePath(`/builds/${buildId}/review`);
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
    message: `Task "${task.title}" → ${status.replace(/_/g, " ")} on ${task.build.title}`,
    link: `/builds/${task.buildId}`,
  });
  revalidatePath(`/builds/${task.buildId}`);
}
