"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, requireFeature } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";

type Created = { id: number };

async function uploadBuildFile(buildId: string, file: File) {
  const contentType = file.type || "application/octet-stream";
  const presign = await serverApi.post<{ upload_url: string; public_url: string; key: string }>(
    "builds/upload/presign",
    { filename: file.name, content_type: contentType, size_bytes: file.size, build: Number(buildId) },
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
    key: presign.key,
    size_bytes: file.size,
    build: Number(buildId),
  });
  return { url: presign.public_url, name: file.name };
}

export async function createBuild(formData: FormData) {
  await requireFeature("builds_manage");
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

export async function deleteBuild(formData: FormData) {
  await requireFeature("builds_manage");
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Build id is required");
  await serverApi.del(`builds/builds/${id}`);
  revalidatePath("/builds");
  redirect("/builds");
}

export async function assignBuild(formData: FormData) {
  await requireFeature("builds_manage");
  const id = String(formData.get("id") ?? "");
  const assigneeId = String(formData.get("assigneeId") ?? "");
  if (!id || !assigneeId) throw new Error("Build and assignee are required");
  await serverApi.post(`builds/builds/${id}/assign`, { assignee_id: Number(assigneeId) });
  revalidatePath(`/builds/${id}`);
}

export async function approveBuild(formData: FormData) {
  await requireFeature("builds_manage");
  const id = String(formData.get("id") ?? "");
  const assigneeId = String(formData.get("assigneeId") ?? "");
  if (!id) throw new Error("Build is required");
  // assignee_id is optional — the backend falls back to the current assignee.
  await serverApi.post(
    `builds/builds/${id}/approve`,
    assigneeId ? { assignee_id: Number(assigneeId) } : {},
  );
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
  const description = String(formData.get("description") ?? "").trim();
  const assignee = String(formData.get("assignee") ?? "").trim();
  if (!buildId || !title) throw new Error("Build and title are required");
  await serverApi.post("builds/tasks", {
    build: Number(buildId), title, type, description,
    assignee: assignee ? Number(assignee) : null,
  });
  revalidatePath(`/builds/${buildId}`);
}

export async function deleteTask(formData: FormData) {
  await requireUser();
  const taskId = String(formData.get("taskId") ?? "");
  const buildId = String(formData.get("buildId") ?? "");
  if (!taskId) throw new Error("Task is required");
  await serverApi.del(`builds/tasks/${taskId}`);
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

export async function reassignTask(formData: FormData) {
  await requireUser();
  const taskId = String(formData.get("taskId") ?? "");
  const buildId = String(formData.get("buildId") ?? "");
  const assignee = String(formData.get("assignee") ?? "").trim();
  if (!taskId) throw new Error("Task is required");
  await serverApi.patch(`builds/tasks/${taskId}`, { assignee: assignee ? Number(assignee) : null });
  revalidatePath(`/builds/${buildId}`);
}

export async function updateBuildSectionReview(formData: FormData) {
  await requireUser();
  const buildId = String(formData.get("buildId") ?? "");
  const section = String(formData.get("section") ?? "");
  const status = String(formData.get("status") ?? "");
  const blockerNote = String(formData.get("blockerNote") ?? "").trim();
  const file = formData.get("blockerFile");
  if (!buildId || !section || !status) throw new Error("Build, section, and status are required");

  let blocker_attachment_url = "";
  let blocker_attachment_name = "";
  if (file instanceof File && file.size > 0) {
    const uploaded = await uploadBuildFile(buildId, file);
    blocker_attachment_url = uploaded.url;
    blocker_attachment_name = uploaded.name;
  }

  await serverApi.post("builds/section-reviews/upsert", {
    build: Number(buildId),
    section,
    status,
    blocker_note: blockerNote,
    blocker_attachment_url,
    blocker_attachment_name,
  });
  revalidatePath(`/builds/${buildId}`);
}

export async function convertSectionBlockerToTask(formData: FormData) {
  await requireUser();
  const reviewId = String(formData.get("reviewId") ?? "");
  const buildId = String(formData.get("buildId") ?? "");
  if (!reviewId || !buildId) throw new Error("Section blocker is required");
  await serverApi.post(`builds/section-reviews/${reviewId}/convert-to-task`, {});
  revalidatePath(`/builds/${buildId}`);
}

export async function requestSectionBlockerInfo(formData: FormData) {
  await requireUser();
  const reviewId = String(formData.get("reviewId") ?? "");
  const buildId = String(formData.get("buildId") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!reviewId || !buildId || !note) throw new Error("A note is required");
  await serverApi.post(`builds/section-reviews/${reviewId}/request-info`, { note });
  revalidatePath(`/builds/${buildId}`);
}

// ─── AI brief + meeting notes ────────────────────────────────────────────────
export async function addMeetingNote(formData: FormData) {
  await requireUser();
  const buildId = String(formData.get("buildId") ?? "");
  const rawText = String(formData.get("rawText") ?? "").trim();
  const kind = String(formData.get("kind") ?? "meeting");
  if (!buildId || !rawText) throw new Error("Note is required");
  await serverApi.post("builds/meeting-notes", { build: Number(buildId), raw_text: rawText, source: "paste", kind });
  revalidatePath(`/builds/${buildId}`);
}

export async function logProgressUpdate(formData: FormData) {
  await requireUser();
  const buildId = String(formData.get("buildId") ?? "");
  const rawText = String(formData.get("rawText") ?? "").trim();
  const kind = String(formData.get("kind") ?? "progress");
  if (!buildId || !rawText) throw new Error("Notes are required");
  // Delta flow: captures scope changes / questions / progress without rewriting
  // the blueprint. Backend processes asynchronously.
  await serverApi.post(`builds/builds/${buildId}/progress-update`, { raw_text: rawText, kind });
  revalidatePath(`/builds/${buildId}`);
}

export async function generateBrief(formData: FormData) {
  await requireFeature("builds_manage");
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
  const dueDate = String(formData.get("dueDate") ?? "").trim();
  const owner = String(formData.get("owner") ?? "").trim();
  if (!buildId || !title || !description) throw new Error("Title and description are required");
  await serverApi.post("builds/change-requests", {
    build: Number(buildId),
    title,
    description,
    impact,
    due_date: dueDate || null,
    owner: owner ? Number(owner) : null,
  });
  revalidatePath(`/builds/${buildId}`);
}

export async function setChangeRequestStatus(formData: FormData) {
  await requireFeature("builds_manage");
  const id = String(formData.get("id") ?? "");
  const buildId = String(formData.get("buildId") ?? "");
  const status = String(formData.get("status") ?? "");
  const blockerNote = String(formData.get("blockerNote") ?? "").trim();
  const file = formData.get("blockerFile");
  if (!id || !status) throw new Error("Change request and status are required");
  let blocker_attachment_url = "";
  let blocker_attachment_name = "";
  if (file instanceof File && file.size > 0) {
    const uploaded = await uploadBuildFile(buildId, file);
    blocker_attachment_url = uploaded.url;
    blocker_attachment_name = uploaded.name;
  }
  const body: Record<string, string> = { status };
  if (blockerNote) body.blocker_note = blockerNote;
  if (blocker_attachment_url) body.blocker_attachment_url = blocker_attachment_url;
  if (blocker_attachment_name) body.blocker_attachment_name = blocker_attachment_name;
  await serverApi.post(`builds/change-requests/${id}/status`, body);
  revalidatePath(`/builds/${buildId}`);
}

export async function generateChangeRequestSteps(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  const buildId = String(formData.get("buildId") ?? "");
  if (!id || !buildId) throw new Error("Change request is required");
  await serverApi.post(`builds/change-requests/${id}/generate-steps`, {});
  revalidatePath(`/builds/${buildId}`);
}

export async function deleteChangeRequest(formData: FormData) {
  await requireFeature("builds_manage");
  const id = String(formData.get("id") ?? "");
  const buildId = String(formData.get("buildId") ?? "");
  if (!id) throw new Error("Change request is required");
  await serverApi.del(`builds/change-requests/${id}`);
  revalidatePath(`/builds/${buildId}`);
}

export async function recordApproval(formData: FormData) {
  await requireFeature("builds_manage");
  const buildId = String(formData.get("buildId") ?? "");
  const type = String(formData.get("type") ?? "BRIEF");
  const note = String(formData.get("note") ?? "").trim();
  if (!buildId) throw new Error("Build is required");
  await serverApi.post("builds/approvals", { build: Number(buildId), type, note });
  revalidatePath(`/builds/${buildId}`);
}

// ─── Client portal ───────────────────────────────────────────────────────────
export async function enablePortal(formData: FormData) {
  await requireFeature("builds_manage");
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
  await uploadBuildFile(buildId, file);
  revalidatePath(`/builds/${buildId}`);
}
