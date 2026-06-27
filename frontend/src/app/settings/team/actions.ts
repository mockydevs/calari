"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireFeature, FEATURE_KEYS } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";

export async function createInvite(formData: FormData) {
  await requireFeature("team");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const role = String(formData.get("role") ?? "MEMBER") === "ADMIN" ? "admin" : "employee";
  if (!name || !email) throw new Error("Name and email are required");
  // Django emails the signup link on creation.
  await serverApi.post("builds/team-invites", { name, email, role });
  revalidatePath("/settings/team");
}

export async function approveUser(formData: FormData) {
  await requireFeature("team");
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("User id is required");
  await serverApi.post(`auth/users/${id}/activate`);
  revalidatePath("/settings/team");
}

export async function deactivateUser(formData: FormData) {
  const admin = await requireFeature("team");
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("User id is required");
  if (id === admin.id) throw new Error("You cannot deactivate yourself");
  await serverApi.post(`auth/users/${id}/deactivate`);
  revalidatePath("/settings/team");
}

export async function cancelInvite(formData: FormData) {
  await requireFeature("team");
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Invite id is required");
  await serverApi.del(`builds/team-invites/${id}`);
  revalidatePath("/settings/team");
}

export async function setUserFeatures(formData: FormData) {
  // Only true admins may grant features (a 'team'-granted member must not escalate).
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("User id is required");
  const granted = FEATURE_KEYS.filter((k) => formData.get(`feature_${k}`) === "on");
  await serverApi.patch(`auth/users/${id}`, { feature_permissions: granted });
  revalidatePath("/settings/team");
}

export async function resendInvite(formData: FormData) {
  await requireFeature("team");
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Invite id is required");
  // Rotates the token + 7-day expiry and re-emails the signup link.
  await serverApi.post(`builds/team-invites/${id}/resend`, {});
  revalidatePath("/settings/team");
}
