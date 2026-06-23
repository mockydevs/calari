/**
 * Calari Staff Portal — browser API client.
 * Talks same-origin to the Next BFF proxy (/api/portal/*), which injects the
 * Django JWT cookie and refreshes on 401.
 */
import type { ApiErrorBody } from "./types";

const PORTAL_BASE = "/api/portal";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** Extract a human-readable message from a DRF error response. */
export function extractApiError(data: unknown, fallback = "An unexpected error occurred."): string {
  if (!data) return fallback;
  if (typeof data === "string") return data;
  const d = data as ApiErrorBody;
  if (typeof d === "object") {
    const obj = d as Record<string, unknown>;
    if (typeof obj.error === "string") return obj.error;
    if (typeof obj.detail === "string") return obj.detail;
    if (Array.isArray(obj.non_field_errors)) return obj.non_field_errors.join(" ");
    const fieldErrors = Object.entries(obj)
      .filter(([, v]) => Array.isArray(v))
      .map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`)
      .join(" | ");
    if (fieldErrors) return fieldErrors;
  }
  return fallback;
}

function buildUrl(path: string, params?: Record<string, unknown>): string {
  const clean = path.replace(/^\/+/, "");
  let url = `${PORTAL_BASE}/${clean}`;
  if (params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  return url;
}

async function parse(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  return null;
}

async function request<T>(path: string, init: RequestInit, params?: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(buildUrl(path, params), { credentials: "same-origin", ...init });
  } catch {
    throw new ApiError("Network error — please check your connection.", 0, null);
  }
  const data = await parse(res);
  if (!res.ok) {
    // Session expired/invalid → bounce to login (avoid loops on auth pages).
    if (res.status === 401 && typeof window !== "undefined") {
      const path = window.location.pathname;
      if (!path.includes("/login") && !path.includes("password")) {
        window.location.href = `/login?next=${encodeURIComponent(path)}`;
      }
    }
    throw new ApiError(extractApiError(data, `Request failed (${res.status}).`), res.status, data);
  }
  return data as T;
}

const jsonHeaders = { "Content-Type": "application/json" };

export const api = {
  get: <T>(path: string, params?: Record<string, unknown>) => request<T>(path, { method: "GET" }, params),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", headers: jsonHeaders, body: JSON.stringify(body ?? {}) }),

  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify(body ?? {}) }),

  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", headers: jsonHeaders, body: JSON.stringify(body ?? {}) }),

  del: <T = void>(path: string) => request<T>(path, { method: "DELETE" }),

  /** Multipart upload (file fields). Pass a FormData; do NOT set Content-Type. */
  upload: <T>(path: string, form: FormData, method: "POST" | "PATCH" | "PUT" = "POST") =>
    request<T>(path, { method, body: form }),
};
