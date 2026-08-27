import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, POST } from "@/app/api/portal/[...path]/route";
import { backendFetch } from "@/lib/portal/backend-fetch";
import { POST as fathomWebhook } from "@/app/api/webhooks/fathom/route";
import { POST as slackWebhook } from "@/app/api/webhooks/slack/route";
import proxy from "@/proxy";

const session = vi.hoisted(() => ({
  getTokens: vi.fn(),
  refreshAccess: vi.fn(),
}));
vi.mock("@/lib/portal/server", () => ({
  ...session,
  djangoCookieHeader: (access?: string) => `access_token=${access ?? ""}`,
}));

const upstream = vi.fn<typeof fetch>();
const context = () => ({ params: Promise.resolve({ path: ["projects", "tasks", "1"] }) });
const request = (method = "GET", body?: string) => new NextRequest("http://localhost/api/portal/projects/tasks/1?view=all", {
  method, body,
  headers: { cookie: "untrusted=browser", "content-type": "application/json" },
});

beforeEach(() => {
  upstream.mockReset();
  session.getTokens.mockReset();
  session.getTokens.mockResolvedValue({ access: "access", refresh: "refresh" });
  session.refreshAccess.mockReset();
  vi.stubGlobal("fetch", upstream);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Django proxy", () => {
  it.each([204, 205, 304])("preserves a bodyless %i response", async (status) => {
    upstream.mockResolvedValue(new Response(null, { status }));
    const response = await DELETE(request("DELETE"), context());
    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
  });

  it("streams downloads and preserves the download headers", async () => {
    const response = new Response("download contents", {
      headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="test.pdf"' },
    });
    upstream.mockResolvedValue(response);
    const result = await GET(request(), context());
    expect(response.bodyUsed).toBe(false);
    expect(result.headers.get("content-disposition")).toContain("test.pdf");
    expect(result.headers.get("content-type")).toBe("application/pdf");
    expect(await result.text()).toBe("download contents");
  });

  it("refreshes only an explicit auth challenge and preserves the write body", async () => {
    upstream.mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ id: 1 }, { status: 201 }));
    session.refreshAccess.mockResolvedValue("renewed");
    const result = await POST(request("POST", '{"title":"Task"}'), context());
    expect(result.status).toBe(201);
    expect(upstream).toHaveBeenCalledTimes(2);
    const [url, init] = upstream.mock.calls[1];
    expect(url).toMatch(/\/projects\/tasks\/1\/\?view=all$/);
    expect(new Headers(init?.headers).get("cookie")).toBe("access_token=renewed");
    expect(Buffer.from(init?.body as Buffer).toString()).toBe('{"title":"Task"}');
  });

  it("converts an unsuccessful auth redirect into 401", async () => {
    upstream.mockResolvedValue(new Response(null, { status: 302, headers: { location: "/login/" } }));
    session.refreshAccess.mockResolvedValue(null);
    const result = await GET(request(), context());
    expect(result.status).toBe(401);
    expect(result.headers.has("location")).toBe(false);
  });

  it.each([
    [new DOMException("Timed out", "TimeoutError"), 504],
    [new TypeError("fetch failed"), 502],
  ])("does not retry a write after a transport failure", async (error, status) => {
    upstream.mockRejectedValue(error);
    const result = await POST(request("POST", "{}"), context());
    expect(result.status).toBe(status);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(session.refreshAccess).not.toHaveBeenCalled();
  });
});

describe("Fathom webhook relay", () => {
  const webhookRequest = (body = '{ "title": "Résumé" }', extraHeaders: Record<string, string> = {}) => new NextRequest("http://localhost/api/webhooks/fathom", {
    method: "POST", body,
    headers: { "webhook-id": "msg_1", "webhook-timestamp": "1234", "webhook-signature": "v1,signed", cookie: "calari_access=browser", authorization: "Bearer browser", ...extraHeaders },
  });

  it("is public without requiring a browser session", () => {
    const response = proxy(new NextRequest("http://localhost/api/webhooks/fathom"));
    expect(response.status).toBe(200);
    expect(response.headers.has("location")).toBe(false);
  });

  it("preserves signed bytes and forwards only webhook headers", async () => {
    const body = '{ "title": "Résumé", "spacing":  true }';
    upstream.mockResolvedValue(Response.json({ ok: true }));
    const response = await fathomWebhook(webhookRequest(body));
    expect(response.status).toBe(200);
    const [url, init] = upstream.mock.calls[0];
    expect(url).toMatch(/\/api\/onboarding\/webhooks\/fathom\/$/);
    expect(Buffer.from(init?.body as Buffer).toString()).toBe(body);
    const headers = new Headers(init?.headers);
    expect(headers.get("webhook-signature")).toBe("v1,signed");
    expect(headers.has("cookie")).toBe(false);
    expect(headers.has("authorization")).toBe(false);
    expect(session.getTokens).not.toHaveBeenCalled();
  });

  it("rejects missing signatures before contacting Django", async () => {
    const response = await fathomWebhook(new NextRequest("http://localhost/api/webhooks/fathom", { method: "POST", body: "{}" }));
    expect(response.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([true, false])("bounds payloads with content-length present=%s", async (withLength) => {
    const body = "x".repeat(2 * 1024 * 1024 + 1);
    const response = await fathomWebhook(webhookRequest(body, withLength ? { "content-length": String(body.length) } : {}));
    expect(response.status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("preserves signature failures from Django", async () => {
    upstream.mockResolvedValue(Response.json({ error: "Invalid webhook signature." }, { status: 401 }));
    expect((await fathomWebhook(webhookRequest())).status).toBe(401);
  });

  it("does not acknowledge an unconfirmed import after a network failure", async () => {
    upstream.mockRejectedValue(new TypeError("fetch failed"));
    expect((await fathomWebhook(webhookRequest())).status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});

describe("backend request deadlines", () => {
  it.each([["GET", 30_000], ["POST", 180_000]])("bounds %s waits", async (method, deadline) => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    upstream.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const pending = backendFetch("http://backend/api/", { method });
    const assertion = expect(pending).rejects.toHaveProperty("name", "TimeoutError");
    controller.abort(new DOMException("Timed out", "TimeoutError"));
    await assertion;
    expect(timeout).toHaveBeenCalledWith(deadline);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("preserves caller cancellation", async () => {
    const controller = new AbortController();
    upstream.mockResolvedValue(new Response(null));
    await backendFetch("http://backend/api/", { signal: controller.signal });
    controller.abort();
    expect(upstream.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});

describe("Slack webhook relay", () => {
  it("no longer exempts retired client portal links from authentication", () => {
    const response = proxy(new NextRequest("http://localhost/portal/retired-token"));
    expect(response.headers.get("location")).toContain("/login");
  });
  function signed(body = '{"text":"Original résumé <@UCLARE>"}', headers: Record<string, string> = {}) {
    return new NextRequest("http://localhost/api/webhooks/slack", { method: "POST", body, headers: { "x-slack-request-timestamp": "1787800000", "x-slack-signature": "v0=test", cookie: "private=session", authorization: "Bearer private", ...headers } });
  }
  it("preserves signed bytes and challenge response without forwarding credentials", async () => {
    upstream.mockResolvedValue(Response.json({ challenge: "challenge" }));
    const response = await slackWebhook(signed());
    expect(await response.json()).toEqual({ challenge: "challenge" });
    const [url, init] = upstream.mock.calls[0];
    expect(url).toMatch(/\/onboarding\/webhooks\/slack\/$/);
    expect(Buffer.from(init?.body as Buffer).toString()).toBe('{"text":"Original résumé <@UCLARE>"}');
    const headers = new Headers(init?.headers);
    expect(headers.get("x-slack-signature")).toBe("v0=test");
    expect(headers.has("cookie")).toBe(false);
    expect(headers.has("authorization")).toBe(false);
    expect(session.getTokens).not.toHaveBeenCalled();
  });
  it("is publicly reachable but rejects missing signature headers", async () => {
    const request = new NextRequest("http://localhost/api/webhooks/slack", { method: "POST", body: "{}" });
    expect(proxy(request).headers.get("location")).toBeNull();
    expect((await slackWebhook(request)).status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });
  it.each([true, false])("limits bodies with content length present: %s", async (hasLength) => {
    const body = "x".repeat(256 * 1024 + 1);
    expect((await slackWebhook(signed(body, hasLength ? { "content-length": String(body.length) } : {}))).status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("propagates signature rejection", async () => {
    upstream.mockResolvedValue(Response.json({ error: "Invalid signature" }, { status: 401 }));
    expect((await slackWebhook(signed())).status).toBe(401);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it("returns retryable failure when backend save is unconfirmed", async () => {
    upstream.mockRejectedValue(new TypeError("network failed"));
    expect((await slackWebhook(signed())).status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
