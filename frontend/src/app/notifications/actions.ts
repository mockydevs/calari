"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth-helpers";

export async function markAllRead() {
  const user = await requireUser();
  await prisma.notification.updateMany({ where: { userId: user.id, read: false }, data: { read: true } });
  revalidatePath("/notifications");
}

export async function markRead(id: string) {
  const user = await requireUser();
  await prisma.notification.updateMany({ where: { id, userId: user.id }, data: { read: true } });
  revalidatePath("/notifications");
}

export async function updateNotificationPreferences(formData: FormData) {
  const user = await requireUser();
  await prisma.notificationPreference.upsert({
    where: { userId: user.id },
    update: {
      buildAssigned: formData.get("buildAssigned") === "on",
      taskUpdated: formData.get("taskUpdated") === "on",
      followUpNotes: formData.get("followUpNotes") === "on",
      changeRequests: formData.get("changeRequests") === "on",
      readyForReview: formData.get("readyForReview") === "on",
      documentUploaded: formData.get("documentUploaded") === "on",
    },
    create: {
      userId: user.id,
      buildAssigned: formData.get("buildAssigned") === "on",
      taskUpdated: formData.get("taskUpdated") === "on",
      followUpNotes: formData.get("followUpNotes") === "on",
      changeRequests: formData.get("changeRequests") === "on",
      readyForReview: formData.get("readyForReview") === "on",
      documentUploaded: formData.get("documentUploaded") === "on",
    },
  });
  revalidatePath("/notifications");
}
