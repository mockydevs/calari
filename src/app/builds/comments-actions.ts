"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth-helpers";
import { notify, logActivity } from "@/lib/notify";
import { commentSchema } from "@/lib/validations";

export async function postBuildComment(buildId: string, formData: FormData) {
  const user = await requireUser();
  const parsed = commentSchema.safeParse({ body: formData.get("body") });
  if (!parsed.success) throw new Error("Comment body required");

  const build = await prisma.build.findUnique({
    where: { id: buildId },
    include: { creator: true, assignee: true },
  });
  if (!build) throw new Error("Build not found");

  await prisma.comment.create({
    data: { buildId, authorId: user.id, body: parsed.data.body },
  });

  await logActivity(buildId, user.name, "left a comment");

  // Notify the other party (admin notifies assignee and vice-versa)
  const notifyId =
    user.id === build.creatorId ? build.assigneeId : build.creatorId;
  if (notifyId && notifyId !== user.id) {
    await notify({
      userId: notifyId,
      type: "NEW_COMMENT",
      message: `New comment on "${build.title}" from ${user.name}`,
      link: `/builds/${buildId}`,
    });
  }

  revalidatePath(`/builds/${buildId}`);
}

export async function postTaskComment(taskId: string, buildId: string, formData: FormData) {
  const user = await requireUser();
  const parsed = commentSchema.safeParse({ body: formData.get("body") });
  if (!parsed.success) throw new Error("Comment body required");

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { build: { include: { creator: true } } },
  });
  if (!task) throw new Error("Task not found");

  await prisma.comment.create({
    data: { taskId, authorId: user.id, body: parsed.data.body },
  });

  // Notify build creator if someone else comments
  if (user.id !== task.build.creatorId) {
    await notify({
      userId: task.build.creatorId,
      type: "TASK_COMMENT",
      message: `${user.name} commented on task "${task.title}"`,
      link: `/builds/${buildId}`,
    });
  }

  revalidatePath(`/builds/${buildId}`);
}
