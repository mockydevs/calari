import { z } from "zod";

export const clientSchema = z.object({
  name: z.string().min(1, "Name is required"),
  company: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  notes: z.string().optional(),
});

export const buildCreateSchema = z.object({
  title: z.string().min(1, "Title is required"),
  clientId: z.string().min(1, "Client is required"),
  notes: z.string().optional(), // meeting notes to feed the AI
});

export const briefUpdateSchema = z.object({
  goals: z.string().optional(),
  integrations: z.string().optional(),
});

export const contactSourceSchema = z.object({
  type: z.enum(["WEBSITE", "ADS", "MANUAL", "OTHER"]),
  label: z.string().min(1),
});

export const stageSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  order: z.number().int(),
  needsManual: z.boolean().default(false),
});

export const manualActionSchema = z.object({
  stageId: z.string().min(1),
  description: z.string().min(1),
  owner: z.string().optional(),
});

export const taskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(["AUTOMATION", "FUNNEL", "FORM", "INTEGRATION", "OTHER"]).default("OTHER"),
  assigneeId: z.string().optional(),
});

export const taskStatusSchema = z.object({
  status: z.enum(["TODO", "IN_PROGRESS", "BLOCKED", "DONE"]),
  progressNote: z.string().optional(),
});

export const commentSchema = z.object({
  body: z.string().min(1),
});
