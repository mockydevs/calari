"use server";

import { revalidatePath } from "next/cache";
import { requireFeature } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";

const PATH = "/settings/integration-maps";

const FIELDS = [
  "client_number", "drive_folder_id", "drive_onboarding_doc_id", "asana_project_gid",
  "slack_internal_channel_id", "slack_external_channel_id", "match_domains", "match_emails",
] as const;

export async function saveIntegrationMap(formData: FormData) {
  await requireFeature("ai_keys");
  const id = String(formData.get("id") ?? "").trim();
  const client = String(formData.get("client") ?? "").trim();
  const payload: Record<string, unknown> = { active: formData.get("active") === "on" };
  for (const f of FIELDS) payload[f] = String(formData.get(f) ?? "").trim();
  if (id) {
    await serverApi.patch(`onboarding/integration-maps/${id}`, payload);
  } else {
    if (!client) throw new Error("Client is required");
    await serverApi.post("onboarding/integration-maps", { ...payload, client: Number(client) });
  }
  revalidatePath(PATH);
}

export async function deleteIntegrationMap(formData: FormData) {
  await requireFeature("ai_keys");
  const id = String(formData.get("id") ?? "").trim();
  if (!id) throw new Error("Map id is required");
  await serverApi.del(`onboarding/integration-maps/${id}`);
  revalidatePath(PATH);
}
