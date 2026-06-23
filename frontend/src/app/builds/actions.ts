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
  const notes = String(formData.get("notes") ?? "").trim();
  if (!title) throw new Error("Title is required");
  if (!client) throw new Error("Client is required");

  const build = await serverApi.post<Created>("builds/builds", {
    title,
    client: Number(client),
    status: "DRAFT",
  });
  if (notes) {
    await serverApi.post("builds/meeting-notes", { build: build.id, raw_text: notes, source: "paste" });
  }
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

// ─── AI brief + meeting notes ────────────────────────────────────────────────
export async function addMeetingNote(formData: FormData) {
  await requireUser();
  const buildId = String(formData.get("buildId") ?? "");
  const rawText = String(formData.get("rawText") ?? "").trim();
  if (!buildId || !rawText) throw new Error("Note is required");
  await serverApi.post("builds/meeting-notes", { build: Number(buildId), raw_text: rawText, source: "follow_up" });
  revalidatePath(`/builds/${buildId}`);
}

export async function generateBrief(formData: FormData) {
  await requireAdmin();
  const buildId = String(formData.get("buildId") ?? "");
  if (!buildId) throw new Error("Build is required");
  await serverApi.post(`builds/builds/${buildId}/generate-brief`, {});
  revalidatePath(`/builds/${buildId}`);
}

// ─── Change requests + approvals ─────────────────────────────────────────────
export async function createChangeRequest(formData: FormData) {
  await requireUser();
  const buildId = String(formData.get("buildId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const impact = String(formData.get("impact") ?? "").trim();
  if (!buildId || !title || !description) throw new Error("Title and description are required");
  await serverApi.post("builds/change-requests", { build: Number(buildId), title, description, impact });
  revalidatePath(`/builds/${buildId}`);
}

export async function setChangeRequestStatus(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const buildId = String(formData.get("buildId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !status) throw new Error("Change request and status are required");
  await serverApi.post(`builds/change-requests/${id}/status`, { status });
  revalidatePath(`/builds/${buildId}`);
}

export async function recordApproval(formData: FormData) {
  await requireAdmin();
  const buildId = String(formData.get("buildId") ?? "");
  const type = String(formData.get("type") ?? "BRIEF");
  const note = String(formData.get("note") ?? "").trim();
  if (!buildId) throw new Error("Build is required");
  await serverApi.post("builds/approvals", { build: Number(buildId), type, note });
  revalidatePath(`/builds/${buildId}`);
}

// ─── Client portal ───────────────────────────────────────────────────────────
export async function enablePortal(formData: FormData) {
  await requireAdmin();
  const buildId = String(formData.get("buildId") ?? "");
  if (!buildId) throw new Error("Build is required");
  await serverApi.post(`builds/builds/${buildId}/enable-portal`, {});
  revalidatePath(`/builds/${buildId}`);
}

// ─── Comments ────────────────────────────────────────────────────────────────
export async function addComment(formData: FormData) {
  await requireUser();
  const buildId = String(formData.get("buildId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!buildId || !body) throw new Error("Comment is required");
  await serverApi.post("builds/comments", { build: Number(buildId), body });
  revalidatePath(`/builds/${buildId}`);
}

// ─── Files (presigned S3 upload) ─────────────────────────────────────────────
export async function uploadDocument(formData: FormData) {
  await requireUser();
  const buildId = String(formData.get("buildId") ?? "");
  const file = formData.get("file");
  if (!buildId || !(file instanceof File) || file.size === 0) throw new Error("A file is required");

  const contentType = file.type || "application/octet-stream";
  const presign = await serverApi.post<{ upload_url: string; public_url: string; key: string }>(
    "builds/upload/presign",
    { filename: file.name, content_type: contentType },
  );
  const put = await fetch(presign.upload_url, {
    method: "PUT",
    body: Buffer.from(await file.arrayBuffer()),
    headers: { "Content-Type": contentType },
  });
  if (!put.ok) throw new Error("Upload to storage failed");
  await serverApi.post("builds/upload/finalize", {
    filename: file.name,
    content_type: contentType,
    public_url: presign.public_url,
    size_bytes: file.size,
    build: Number(buildId),
  });
  revalidatePath(`/builds/${buildId}`);
}
