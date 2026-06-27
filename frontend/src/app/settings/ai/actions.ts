"use server";

import { revalidatePath } from "next/cache";
import { requireFeature } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";

export async function createApiKey(formData: FormData) {
  await requireFeature("ai_keys");
  const provider = String(formData.get("provider") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  const makeActive = formData.get("active") === "on";
  if (!label) throw new Error("Label is required");
  if (!apiKey) throw new Error("API key is required");

  // Django builds.AiApiKey — encrypts + enforces one active key per provider.
  await serverApi.post("builds/ai-keys", { provider, label, api_key: apiKey, active: makeActive });
  revalidatePath("/settings/ai");
}

export async function activateApiKey(formData: FormData) {
  await requireFeature("ai_keys");
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("API key id is required");
  await serverApi.post(`builds/ai-keys/${id}/activate`);
  revalidatePath("/settings/ai");
}

export async function deleteApiKey(formData: FormData) {
  await requireFeature("ai_keys");
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("API key id is required");
  await serverApi.del(`builds/ai-keys/${id}`);
  revalidatePath("/settings/ai");
}

export async function updateAiConfig(formData: FormData) {
  await requireFeature("ai_keys");
  // Which provider + model the AI generation uses (the active key within that
  // provider is chosen separately via Activate).
  await serverApi.patch("builds/ai-config", {
    provider: String(formData.get("provider") ?? "OPENAI"),
    model: String(formData.get("model") ?? "").trim(),
    blueprint_model: String(formData.get("blueprint_model") ?? "").trim(),
    multi_pass: formData.get("multi_pass") === "on",
  });
  revalidatePath("/settings/ai");
}
