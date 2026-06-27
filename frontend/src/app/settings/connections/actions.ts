"use server";

import { revalidatePath } from "next/cache";
import { requireFeature } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";

const PATH = "/settings/connections";

export async function createConnection(formData: FormData) {
  await requireFeature("ai_keys");
  const provider = String(formData.get("provider") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  const secret = String(formData.get("secret") ?? "").trim();
  const auth_type = String(formData.get("auth_type") ?? "api_key");
  const workspace_ref = String(formData.get("workspace_ref") ?? "").trim();
  const active = formData.get("active") === "on";
  if (!provider) throw new Error("Provider is required");
  if (!secret) throw new Error("A token / API key is required");
  await serverApi.post("onboarding/connections", {
    provider, label, secret, auth_type, workspace_ref, active,
  });
  revalidatePath(PATH);
}

export async function activateConnection(formData: FormData) {
  await requireFeature("ai_keys");
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Connection id is required");
  await serverApi.patch(`onboarding/connections/${id}`, { active: true });
  revalidatePath(PATH);
}

export async function deleteConnection(formData: FormData) {
  await requireFeature("ai_keys");
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Connection id is required");
  await serverApi.del(`onboarding/connections/${id}`);
  revalidatePath(PATH);
}

export async function renameConnection(formData: FormData) {
  await requireFeature("ai_keys");
  const id = String(formData.get("id") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  if (!id) throw new Error("Connection id is required");
  await serverApi.patch(`onboarding/connections/${id}`, { label });
  revalidatePath(PATH);
}

export async function updateAutomationSettings(formData: FormData) {
  await requireFeature("ai_keys");
  const threshold = Number(formData.get("confidence_threshold") ?? 0.6);
  await serverApi.patch("onboarding/automation-settings", {
    enabled: formData.get("enabled") === "on",
    external_posting_enabled: formData.get("external_posting_enabled") === "on",
    confidence_threshold: Number.isFinite(threshold) ? Math.min(1, Math.max(0, threshold)) : 0.6,
    ops_alert_channel_id: String(formData.get("ops_alert_channel_id") ?? "").trim(),
  });
  revalidatePath(PATH);
}
