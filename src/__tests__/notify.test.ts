import { describe, it, expect, vi, beforeEach } from "vitest";

const mockNotificationCreate = vi.fn().mockResolvedValue({ id: "notif_1" });
const mockActivityCreate = vi.fn().mockResolvedValue({ id: "act_1" });
const mockUserFindUnique = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/db", () => ({
  prisma: {
    notification: { create: mockNotificationCreate },
    activity: { create: mockActivityCreate },
    user: { findUnique: mockUserFindUnique },
  },
}));

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: vi.fn().mockResolvedValue({ id: "email_1" }) },
  })),
}));

// Import after mocks are set up
const { notify, logActivity } = await import("@/lib/notify");

describe("notify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a notification row with the correct data", async () => {
    await notify({ userId: "u1", type: "BUILD_ASSIGNED", message: "Build assigned", link: "/builds/1" });
    expect(mockNotificationCreate).toHaveBeenCalledWith({
      data: { userId: "u1", type: "BUILD_ASSIGNED", message: "Build assigned", link: "/builds/1" },
    });
  });

  it("returns the created notification", async () => {
    mockNotificationCreate.mockResolvedValueOnce({ id: "notif_test" });
    const result = await notify({ userId: "u1", type: "TASK_UPDATED", message: "Task done", link: "/builds/1" });
    expect(result).toEqual({ id: "notif_test" });
  });

  it("does not throw when user has no email (no Resend key)", async () => {
    mockUserFindUnique.mockResolvedValueOnce(null);
    await expect(
      notify({ userId: "u1", type: "BUILD_ASSIGNED", message: "msg", link: "/builds/1" })
    ).resolves.not.toThrow();
  });
});

describe("logActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an activity row with the correct data", async () => {
    await logActivity("build_1", "Clare", "created the build");
    expect(mockActivityCreate).toHaveBeenCalledWith({
      data: { buildId: "build_1", actor: "Clare", message: "created the build" },
    });
  });

  it("returns the created activity", async () => {
    mockActivityCreate.mockResolvedValueOnce({ id: "act_test" });
    const result = await logActivity("build_1", "Clare", "assigned");
    expect(result).toEqual({ id: "act_test" });
  });
});
