"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import { BLUEPRINT_SECTIONS } from "./_blueprint-config";

// Generic create/update/delete for any editable blueprint section. The section is
// chosen by a hidden `__resource` field; the payload is coerced from the section's
// field config so types (numbers, booleans, nullable stage FKs) are always correct.

function buildPayload(resource: string, formData: FormData, opts: { create: boolean; buildId: string }) {
  const section = BLUEPRINT_SECTIONS[resource];
  if (!section) throw new Error(`Unknown blueprint section: ${resource}`);
  const payload: Record<string, unknown> = {};
  if (opts.create) payload.build = Number(opts.buildId);
  for (const f of section.fields) {
    const raw = formData.get(f.name);
    if (f.input === "number") payload[f.name] = raw == null || raw === "" ? 0 : Number(raw);
    else if (f.input === "bool") payload[f.name] = String(raw) === "true";
    else if (f.input === "stage") payload[f.name] = raw ? Number(raw) : null;
    else payload[f.name] = raw == null ? "" : String(raw);
  }
  return { section, payload };
}

export async function createBlueprintItem(formData: FormData) {
  await requireAdmin();
  const resource = String(formData.get("__resource") ?? "");
  const buildId = String(formData.get("__buildId") ?? "");
  if (!buildId) throw new Error("Build is required");
  const { section, payload } = buildPayload(resource, formData, { create: true, buildId });
  await serverApi.post(section.path, payload);
  revalidatePath(`/builds/${buildId}`);
}

export async function updateBlueprintItem(formData: FormData) {
  await requireAdmin();
  const resource = String(formData.get("__resource") ?? "");
  const buildId = String(formData.get("__buildId") ?? "");
  const id = String(formData.get("__id") ?? "");
  if (!buildId || !id) throw new Error("Build and item id are required");
  const { section, payload } = buildPayload(resource, formData, { create: false, buildId });
  await serverApi.patch(`${section.path}/${id}`, payload);
  revalidatePath(`/builds/${buildId}`);
}

export async function deleteBlueprintItem(formData: FormData) {
  await requireAdmin();
  const resource = String(formData.get("__resource") ?? "");
  const buildId = String(formData.get("__buildId") ?? "");
  const id = String(formData.get("__id") ?? "");
  const section = BLUEPRINT_SECTIONS[resource];
  if (!section || !buildId || !id) throw new Error("Build and item id are required");
  await serverApi.del(`${section.path}/${id}`);
  revalidatePath(`/builds/${buildId}`);
}
