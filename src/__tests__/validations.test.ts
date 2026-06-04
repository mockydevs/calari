import { describe, it, expect } from "vitest";
import {
  clientSchema,
  buildCreateSchema,
  briefUpdateSchema,
  contactSourceSchema,
  stageSchema,
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

describe("buildCreateSchema", () => {
  it("accepts valid build", () => {
    expect(buildCreateSchema.safeParse({ title: "Build 1", clientId: "abc" }).success).toBe(true);
  });
  it("rejects empty title", () => {
    expect(buildCreateSchema.safeParse({ title: "", clientId: "abc" }).success).toBe(false);
  });
  it("rejects empty clientId", () => {
    expect(buildCreateSchema.safeParse({ title: "Build 1", clientId: "" }).success).toBe(false);
  });
  it("accepts optional notes", () => {
    const r = buildCreateSchema.safeParse({ title: "Build 1", clientId: "abc", notes: "Some notes" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.notes).toBe("Some notes");
  });
});

describe("briefUpdateSchema", () => {
  it("accepts partial update", () => {
    expect(briefUpdateSchema.safeParse({ goals: "Close leads faster" }).success).toBe(true);
  });
  it("accepts empty object", () => {
    expect(briefUpdateSchema.safeParse({}).success).toBe(true);
  });
});

describe("contactSourceSchema", () => {
  it("accepts all valid types", () => {
    for (const type of ["WEBSITE", "ADS", "MANUAL", "OTHER"] as const) {
      expect(contactSourceSchema.safeParse({ type, label: "Test" }).success).toBe(true);
    }
  });
  it("rejects invalid type", () => {
    expect(contactSourceSchema.safeParse({ type: "INVALID", label: "Test" }).success).toBe(false);
  });
  it("rejects empty label", () => {
    expect(contactSourceSchema.safeParse({ type: "WEBSITE", label: "" }).success).toBe(false);
  });
});

describe("stageSchema", () => {
  it("accepts valid stage", () => {
    expect(stageSchema.safeParse({ name: "Intake", order: 1 }).success).toBe(true);
  });
  it("defaults needsManual to false", () => {
    const r = stageSchema.safeParse({ name: "Intake", order: 1 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.needsManual).toBe(false);
  });
  it("rejects non-integer order", () => {
    expect(stageSchema.safeParse({ name: "Intake", order: 1.5 }).success).toBe(false);
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
    for (const type of ["AUTOMATION", "FUNNEL", "FORM", "INTEGRATION", "OTHER"] as const) {
      expect(taskSchema.safeParse({ title: "Task", type }).success).toBe(true);
    }
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
