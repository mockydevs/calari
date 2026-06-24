"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, requireAdmin } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";

type Created = { id: number };

function num(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  return s ? Number(s) : null;
}
function str(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}

function projectPayload(formData: FormData) {
  const name = str(formData.get("name"));
  if (!name) throw new Error("Project name is required");
  const client = num(formData.get("client"));
  if (!client) throw new Error("Client is required");
  const start_date = str(formData.get("start_date"));
  const end_date = str(formData.get("end_date"));
  if (!start_date || !end_date) throw new Error("Start and end dates are required");
  return {
    name,
    client,
    status: str(formData.get("status")) || "active",
    priority: str(formData.get("priority")) || "medium",
    description: str(formData.get("description")),
    budget: str(formData.get("budget")) || null,
    assigned_to: num(formData.get("assigned_to")),
    start_date,
    end_date,
  };
}

// ─── Projects ────────────────────────────────────────────────────────────────
export async function createProject(formData: FormData) {
  await requireAdmin();
  const created = await serverApi.post<Created>("projects/projects", projectPayload(formData));
  revalidatePath("/projects");
  redirect(`/projects/${created.id}`);
}

export async function updateProject(formData: FormData) {
  await requireAdmin();
  const id = str(formData.get("id"));
  if (!id) throw new Error("Project id is required");
  await serverApi.patch(`projects/projects/${id}`, projectPayload(formData));
  revalidatePath(`/projects/${id}`);
  revalidatePath("/projects");
}

export async function deleteProject(formData: FormData) {
  await requireAdmin();
  const id = str(formData.get("id"));
  if (!id) throw new Error("Project id is required");
  await serverApi.del(`projects/projects/${id}`);
  revalidatePath("/projects");
  redirect("/projects");
}

// ─── Milestones ──────────────────────────────────────────────────────────────
export async function addMilestone(formData: FormData) {
  await requireUser();
  const projectId = str(formData.get("projectId"));
  const name = str(formData.get("name"));
  if (!projectId || !name) throw new Error("Milestone name is required");
  await serverApi.post("projects/project-milestones", {
    project: Number(projectId),
    name,
    description: str(formData.get("description")),
    due_date: str(formData.get("due_date")) || null,
  });
  revalidatePath(`/projects/${projectId}`);
}

export async function completeMilestone(formData: FormData) {
  await requireUser();
  const id = str(formData.get("id"));
  const projectId = str(formData.get("projectId"));
  const completed = str(formData.get("completed")) === "true";
  await serverApi.patch(`projects/project-milestones/${id}`, { completed: !completed });
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteMilestone(formData: FormData) {
  await requireAdmin();
  const id = str(formData.get("id"));
  const projectId = str(formData.get("projectId"));
  await serverApi.del(`projects/project-milestones/${id}`);
  revalidatePath(`/projects/${projectId}`);
}

// ─── Blockers ────────────────────────────────────────────────────────────────
export async function addBlocker(formData: FormData) {
  await requireUser();
  const projectId = str(formData.get("projectId"));
  const description = str(formData.get("description"));
  if (!projectId || !description) throw new Error("Blocker description is required");
  await serverApi.post("projects/project-blockers", { project: Number(projectId), description });
  revalidatePath(`/projects/${projectId}`);
}

export async function resolveBlocker(formData: FormData) {
  await requireUser();
  const id = str(formData.get("id"));
  const projectId = str(formData.get("projectId"));
  await serverApi.patch(`projects/project-blockers/${id}`, { resolved: true });
  revalidatePath(`/projects/${projectId}`);
}

// ─── Contacts ────────────────────────────────────────────────────────────────
export async function addContact(formData: FormData) {
  await requireUser();
  const projectId = str(formData.get("projectId"));
  const name = str(formData.get("name"));
  if (!projectId || !name) throw new Error("Contact name is required");
  await serverApi.post("projects/project-contacts", {
    project: Number(projectId),
    name,
    email: str(formData.get("email")),
    phone_number: str(formData.get("phone_number")),
    role: str(formData.get("role")),
  });
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteContact(formData: FormData) {
  await requireAdmin();
  const id = str(formData.get("id"));
  const projectId = str(formData.get("projectId"));
  await serverApi.del(`projects/project-contacts/${id}`);
  revalidatePath(`/projects/${projectId}`);
}

// ─── Tasks (detail) ──────────────────────────────────────────────────────────
function taskPath(formData: FormData) {
  return `/projects/${str(formData.get("projectId"))}/tasks/${str(formData.get("taskId"))}`;
}

export async function updateTask(formData: FormData) {
  await requireUser();
  const id = str(formData.get("taskId"));
  if (!id) throw new Error("Task id is required");
  const labels = formData.getAll("labels").map((v) => Number(v)).filter(Boolean);
  await serverApi.patch(`projects/tasks/${id}`, {
    name: str(formData.get("name")),
    description: str(formData.get("description")),
    status: str(formData.get("status")) || "todo",
    priority: str(formData.get("priority")) || "medium",
    assigned_to: num(formData.get("assigned_to")),
    due_date: str(formData.get("due_date")) || null,
    ...(labels.length ? { label_ids: labels } : {}),
  });
  revalidatePath(taskPath(formData));
}

export async function deleteTask(formData: FormData) {
  await requireAdmin();
  const id = str(formData.get("taskId"));
  const projectId = str(formData.get("projectId"));
  if (!id) throw new Error("Task id is required");
  await serverApi.del(`projects/tasks/${id}`);
  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}/board`);
}

export async function addChecklistItem(formData: FormData) {
  await requireUser();
  const taskId = str(formData.get("taskId"));
  const title = str(formData.get("title"));
  if (!taskId || !title) throw new Error("Checklist item is required");
  await serverApi.post("projects/task-checklist", { task: Number(taskId), title });
  revalidatePath(taskPath(formData));
}

export async function toggleChecklistItem(formData: FormData) {
  await requireUser();
  const id = str(formData.get("id"));
  const completed = str(formData.get("completed")) === "true";
  await serverApi.patch(`projects/task-checklist/${id}`, { completed: !completed });
  revalidatePath(taskPath(formData));
}

export async function deleteChecklistItem(formData: FormData) {
  await requireUser();
  const id = str(formData.get("id"));
  await serverApi.del(`projects/task-checklist/${id}`);
  revalidatePath(taskPath(formData));
}

export async function addTaskComment(formData: FormData) {
  await requireUser();
  const taskId = str(formData.get("taskId"));
  const content = str(formData.get("content"));
  if (!taskId || !content) throw new Error("Comment is required");
  await serverApi.post("projects/task-comments", { task: Number(taskId), content });
  revalidatePath(taskPath(formData));
}

export async function addTaskBlocker(formData: FormData) {
  await requireUser();
  const taskId = str(formData.get("taskId"));
  const description = str(formData.get("description"));
  if (!taskId || !description) throw new Error("Blocker description is required");
  await serverApi.post("projects/task-blockers", { task: Number(taskId), description });
  revalidatePath(taskPath(formData));
}

export async function resolveTaskBlocker(formData: FormData) {
  await requireUser();
  const id = str(formData.get("id"));
  await serverApi.patch(`projects/task-blockers/${id}`, { resolved: true });
  revalidatePath(taskPath(formData));
}
