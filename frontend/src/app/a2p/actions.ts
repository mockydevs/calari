"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireFeature } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";

export async function updateA2PSubmission(formData: FormData) {
  await requireFeature("a2p");
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Submission id is required");
  const payload: Record<string, unknown> = {};
  const status = String(formData.get("status") ?? "").trim();
  if (status) payload.status = status;
  if (formData.has("review_notes")) payload.review_notes = String(formData.get("review_notes") ?? "");
  await serverApi.patch(`a2p/submissions/${id}`, payload);
  revalidatePath(`/a2p/${id}`);
  revalidatePath("/a2p");
}

export async function deleteA2PSubmission(formData: FormData) {
  await requireFeature("a2p");
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Submission id is required");
  await serverApi.del(`a2p/submissions/${id}`);
  revalidatePath("/a2p");
  redirect("/a2p");
}
