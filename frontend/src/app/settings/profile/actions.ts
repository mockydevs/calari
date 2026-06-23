"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";

export async function updateProfile(formData: FormData) {
  await requireUser();
  const full_name = String(formData.get("full_name") ?? "").trim();
  const job_title = String(formData.get("job_title") ?? "").trim();
  if (!full_name) throw new Error("Name is required");
  await serverApi.patch("auth/me", { full_name, job_title });
  revalidatePath("/settings/profile");
  revalidatePath("/dashboard");
}

export async function updatePassword(formData: FormData) {
  await requireUser();
  const current_password = String(formData.get("currentPassword") ?? "");
  const new_password = String(formData.get("newPassword") ?? "");
  const confirm_password = String(formData.get("confirmPassword") ?? "");
  if (new_password.length < 8) throw new Error("New password must be at least 8 characters");
  if (new_password !== confirm_password) throw new Error("Passwords do not match");

  // Django re-issues the JWT cookies on success.
  await serverApi.post("auth/change-password", { current_password, new_password, confirm_password });
  revalidatePath("/settings/profile");
}
