"use server";
import { revalidatePath } from "next/cache";
import OpenAI from "openai";
import { prisma } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/auth-helpers";

const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const model = () => process.env.OPENAI_MODEL ?? "gpt-4o-mini";

// ─── Per-task SOP generator ──────────────────────────────────────────────────

export type SOPResult = { sop: string };

/**
 * Generates a step-by-step implementation SOP for a single task,
 * grounded in the build's goals, integrations, and pipeline stages.
 */
export async function generateTaskSOP(taskId: string): Promise<SOPResult> {
  await requireUser();
  if (!client) throw new Error("OPENAI_API_KEY is not configured");

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      build: {
        include: {
          stages: { include: { manualActions: true }, orderBy: { order: "asc" } },
          contactSources: true,
        },
      },
    },
  });
  if (!task) throw new Error("Task not found");

  const { build } = task;
  const context = [
    `Build goals: ${build.goals ?? "not specified"}`,
    `Integrations: ${build.integrations ?? "none listed"}`,
    `Pipeline stages: ${build.stages.map((s) => s.name).join(" → ")}`,
    `Contact sources: ${build.contactSources.map((s) => s.label).join(", ") || "none"}`,
  ].join("\n");

  const prompt = `You are a senior GHL/Zapier solutions architect at Calari Solutions.
Write a concise, numbered step-by-step implementation guide (SOP) for the following task.
Use platform-specific terms (GHL workflows, triggers, Zapier Zaps, etc.) where appropriate.
Be practical and specific — someone who knows GHL should be able to follow this without guessing.

Task title: ${task.title}
Task type: ${task.type}
Task description: ${task.description ?? "no description"}

Build context:
${context}

Respond ONLY with the numbered SOP steps. No intro or outro sentences.`;

  const completion = await client.chat.completions.create({
    model: model(),
    messages: [{ role: "user", content: prompt }],
    max_tokens: 800,
  });

  const sop = completion.choices[0]?.message?.content?.trim() ?? "";
  if (!sop) throw new Error("AI returned no SOP content");

  // Persist SOP into task description if it was empty
  if (!task.description) {
    await prisma.task.update({ where: { id: taskId }, data: { description: sop } });
    revalidatePath(`/builds/${build.id}`);
  }

  return { sop };
}

// ─── Brief-vs-build QA check ─────────────────────────────────────────────────

export type QAIssue = { area: string; issue: string; severity: "high" | "medium" | "low" };
export type QAReport = { issues: QAIssue[]; summary: string };

const qaSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          area: { type: "string" },
          issue: { type: "string" },
          severity: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["area", "issue", "severity"],
      },
    },
    summary: { type: "string" },
  },
  required: ["issues", "summary"],
} as const;

/**
 * Compares the AI-generated brief against actual build progress and
 * returns a list of gaps / issues to address before marking DELIVERED.
 */
export async function runBriefQACheck(buildId: string): Promise<QAReport> {
  await requireAdmin();
  if (!client) throw new Error("OPENAI_API_KEY is not configured");

  const build = await prisma.build.findUnique({
    where: { id: buildId },
    include: {
      contactSources: true,
      stages: { include: { manualActions: true }, orderBy: { order: "asc" } },
      tasks: { orderBy: { createdAt: "asc" } },
      meetingNotes: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!build) throw new Error("Build not found");

  const brief = [
    `Goals: ${build.goals ?? "not set"}`,
    `Integrations: ${build.integrations ?? "none"}`,
    `Contact sources: ${build.contactSources.map((s) => `${s.type}:${s.label}`).join(", ") || "none"}`,
    `Pipeline stages (${build.stages.length}): ${build.stages.map((s) => s.name).join(" → ")}`,
  ].join("\n");

  const taskLines = build.tasks.map(
    (t) => `[${t.status}] ${t.title} (${t.type})${t.aiGenerated ? " [AI]" : ""}`
  );

  const prompt = `You are a QA reviewer for an automation agency build. Compare the brief against the current task list and flag gaps, missing items, or potential delivery risks.

BRIEF:
${brief}

TASKS (${build.tasks.length} total):
${taskLines.join("\n") || "none"}

Return JSON matching the schema. Be concise and specific. Focus on meaningful gaps — not style nitpicks.`;

  const completion = await client.chat.completions.create({
    model: model(),
    messages: [{ role: "user", content: prompt }],
    response_format: {
      type: "json_schema",
      json_schema: { name: "qa_report", strict: true, schema: qaSchema },
    },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("AI returned no QA content");
  return JSON.parse(raw) as QAReport;
}
