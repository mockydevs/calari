"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";

export async function markAllRead() {
  await requireUser();
  await serverApi.post("builds/notifications/mark-all-read");
  revalidatePath("/notifications");
}

export async function markRead(id: string) {
  await requireUser();
  await serverApi.post(`builds/notifications/${id}/mark-read`);
  revalidatePath("/notifications");
}

export async function updateNotificationPreferences(formData: FormData) {
  await requireUser();
  await serverApi.patch("builds/notification-preferences", {
    build_assigned: formData.get("build_assigned") === "on",
    task_updated: formData.get("task_updated") === "on",
    follow_up_notes: formData.get("follow_up_notes") === "on",
    change_requests: formData.get("change_requests") === "on",
    ready_for_review: formData.get("ready_for_review") === "on",
    document_uploaded: formData.get("document_uploaded") === "on",
  });
  revalidatePath("/notifications");
}
