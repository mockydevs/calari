import { describe, it, expect } from "vitest";
import {
  clientSchema,
  taskSchema,
  taskStatusSchema,
  commentSchema,
} from "@/lib/validations";

describe("clientSchema", () => {
  it("accepts a minimal client", () => {
    expect(clientSchema.safeParse({ name: "Acme" }).success).toBe(true);
  });
  it("accepts a client with all fields", () => {
    expect(clientSchema.safeParse({ name: "Acme", company: "Acme Corp", email: "a@acme.com", notes: "VIP" }).success).toBe(true);
  });
  it("rejects empty name", () => {
    expect(clientSchema.safeParse({ name: "" }).success).toBe(false);
  });
  it("rejects invalid email", () => {
    expect(clientSchema.safeParse({ name: "Acme", email: "not-an-email" }).success).toBe(false);
  });
  it("allows empty string email (optional field)", () => {
    expect(clientSchema.safeParse({ name: "Acme", email: "" }).success).toBe(true);
  });
});

describe("taskSchema", () => {
  it("defaults type to OTHER", () => {
    const r = taskSchema.safeParse({ title: "Set up funnel" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.type).toBe("OTHER");
  });
  it("rejects empty title", () => {
    expect(taskSchema.safeParse({ title: "" }).success).toBe(false);
  });
  it("accepts all valid types", () => {
    for (const type of ["AUTOMATION", "PIPELINE", "TAG", "FUNNEL", "FORM", "EMAIL", "INTEGRATION", "OTHER"] as const) {
      expect(taskSchema.safeParse({ title: "Task", type }).success).toBe(true);
    }
  });
  it("rejects whitespace-only titles and unsupported priorities", () => {
    expect(taskSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(taskSchema.safeParse({ title: "Task", priority: "CRITICAL" }).success).toBe(false);
    expect(taskSchema.parse({ title: "  Task  ", priority: "URGENT" }).title).toBe("Task");
  });
});

describe("taskStatusSchema", () => {
  it("accepts all valid statuses", () => {
    for (const status of ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"] as const) {
      expect(taskStatusSchema.safeParse({ status }).success).toBe(true);
    }
  });
  it("rejects invalid status", () => {
    expect(taskStatusSchema.safeParse({ status: "PENDING" }).success).toBe(false);
  });
  it("accepts optional progressNote", () => {
    const r = taskStatusSchema.safeParse({ status: "IN_PROGRESS", progressNote: "Working on it" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.progressNote).toBe("Working on it");
  });
});

describe("commentSchema", () => {
  it("accepts valid comment", () => {
    expect(commentSchema.safeParse({ body: "Looks good." }).success).toBe(true);
  });
  it("rejects empty body", () => {
    expect(commentSchema.safeParse({ body: "" }).success).toBe(false);
  });
});
