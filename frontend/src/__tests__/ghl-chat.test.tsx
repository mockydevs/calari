import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResponseText } from "@/app/chat/response-text";
import { downloadChatExport } from "@/app/chat/exports";
import { hasOutstandingRun, prependHistory, type ChatDetail, type ChatRun } from "@/app/chat/types";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("GHL chat response rendering", () => {
  it("renders helpful formatting but never activates HTML or model-provided links", () => {
    const html = renderToStaticMarkup(createElement(ResponseText, { text: "## Results\n\n**12 contacts** from `GHL`.\n\n<script>alert(1)</script>\n[Click](javascript:alert(1))\n\n- First source\n- Second source" }));
    expect(html).toContain("<h3");
    expect(html).toContain("<strong");
    expect(html).toContain("<ul");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("href=");
  });

  it("keeps the composer blocked until a pending action is decided", () => {
    const runs = (status: ChatRun["status"]) => [{ status }] as ChatRun[];
    expect(hasOutstandingRun(runs("awaiting_confirmation"))).toBe(true);
    expect(hasOutstandingRun(runs("executing"))).toBe(true);
    expect(hasOutstandingRun(runs("done"))).toBe(false);
    expect(hasOutstandingRun(runs("rejected"))).toBe(false);
  });

  it("prepends older history without duplicates or overwriting a freshly polled run", () => {
    const current = { id: "conversation", account_id: 1, page: 1, run_count: 30, runs: [
      { id: "overlap", status: "done" }, { id: "newest", status: "running" },
    ] } as ChatDetail;
    const older = { ...current, page: 2, has_more: false, run_count: 29, runs: [
      { id: "earliest", status: "done" }, { id: "overlap", status: "running" },
    ] } as ChatDetail;
    const result = prependHistory(current, older);
    expect(result.runs.map((run) => run.id)).toEqual(["earliest", "overlap", "newest"]);
    expect(result.runs[1].status).toBe("done");
    expect(result.page).toBe(2);
    expect(result.has_more).toBe(false);
    expect(result.run_count).toBe(30);
    expect(prependHistory(current, { ...older, account_id: 2 })).toBe(current);
    expect(prependHistory(current, { ...older, id: "other" })).toBe(current);
  });
});

describe("GHL report downloads", () => {
  const id = "cab76525-882d-47fd-9946-130f32f7d930";

  it("rejects path injection before making a request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(downloadChatExport("../../private", "csv")).rejects.toThrow("Invalid report identifier");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not download an authentication failure as a CSV", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Denied", { status: 403 })));
    await expect(downloadChatExport(id, "csv")).rejects.toThrow("access to this report has expired");
  });

  it("rejects an HTML login page or JSON error returned with status 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<p>Sign in</p>", { headers: { "content-type": "text/html" } })));
    await expect(downloadChatExport(id, "pdf")).rejects.toThrow("requested report format");
  });

  it("downloads a same-origin report and releases its object URL", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue(new Response("id,count\r\n1,12", { headers: { "content-type": "text/csv" } }));
    vi.stubGlobal("fetch", fetcher);
    const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal("document", { createElement: () => anchor, body: { appendChild: vi.fn() } });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:report");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    await downloadChatExport(id, "csv");
    expect(fetcher).toHaveBeenCalledWith(`/api/portal/ghl-chat/runs/${id}/export/csv/`, { credentials: "same-origin" });
    expect(anchor.download).toBe(`ghl-report-${id}.csv`);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:report");
  });
});
