"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, requireAdmin } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";

type Created = { id: number };

export async function createBuild(formData: FormData) {
  await requireAdmin();
  const title = String(formData.get("title") ?? "").trim();
  const client = String(formData.get("client") ?? "");
  if (!title) throw new Error("Title is required");
  if (!client) throw new Error("Client is required");

  const build = await serverApi.post<Created>("builds/builds", {
    title,
    client: Number(client),
    status: "DRAFT",
  });
  revalidatePath("/builds");
  redirect(`/builds/${build.id}`);
}

export async function assignBuild(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const assigneeId = String(formData.get("assigneeId") ?? "");
  if (!id || !assigneeId) throw new Error("Build and assignee are required");
  await serverApi.post(`builds/builds/${id}/assign`, { assignee_id: Number(assigneeId) });
  revalidatePath(`/builds/${id}`);
}

export async function setBuildStatus(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !status) throw new Error("Build and status are required");
  await serverApi.post(`builds/builds/${id}/status`, { status });
  revalidatePath(`/builds/${id}`);
}

export async function createTask(formData: FormData) {
  await requireUser();
  const buildId = String(formData.get("buildId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const type = String(formData.get("type") ?? "OTHER");
  if (!buildId || !title) throw new Error("Build and title are required");
  await serverApi.post("builds/tasks", { build: Number(buildId), title, type });
  revalidatePath(`/builds/${buildId}`);
}

export async function updateTaskStatus(formData: FormData) {
  await requireUser();
  const taskId = String(formData.get("taskId") ?? "");
  const buildId = String(formData.get("buildId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!taskId || !status) throw new Error("Task and status are required");
  await serverApi.post(`builds/tasks/${taskId}/status`, { status });
  revalidatePath(`/builds/${buildId}`);
}
