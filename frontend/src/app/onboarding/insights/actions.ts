"use server";

import { revalidatePath } from "next/cache";
import { requireFeature } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";

export async function retractEvent(formData: FormData) {
  await requireFeature("ai_keys");
  const id = String(formData.get("id") ?? "").trim();
  if (!id) throw new Error("Event id is required");
  await serverApi.post(`onboarding/integration-events/${id}/retract`, {});
  revalidatePath("/onboarding/insights");
}
