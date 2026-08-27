import { z } from "zod";

export const clientSchema = z.object({
  name: z.string().min(1, "Name is required"),
  company: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  notes: z.string().optional(),
});

export const taskSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().optional(),
  type: z.enum(["AUTOMATION", "PIPELINE", "TAG", "FUNNEL", "FORM", "EMAIL", "INTEGRATION", "OTHER"]).default("OTHER"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  assigneeId: z.string().optional(),
});

export const taskStatusSchema = z.object({
  status: z.enum(["TODO", "IN_PROGRESS", "BLOCKED", "DONE"]),
  progressNote: z.string().optional(),
});

export const commentSchema = z.object({
  body: z.string().min(1),
});
