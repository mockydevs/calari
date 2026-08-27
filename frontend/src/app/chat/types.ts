export type ChatAccount = { id: number; name: string; location_id: string; timezone: string; synthetic: boolean; can_execute: boolean };
export type ChatAccounts = {
  accounts: ChatAccount[];
  manager: boolean;
  connections?: { client_id: number; name: string; location_id: string }[];
  staff?: { id: number; name: string }[];
};
export type ChatGrant = { user_id: number; name: string; can_execute: boolean };
export type ChatConversation = { id: string; title: string; account_id: number; created_at: string };
type ChatProposal = {
  operation: { operationId?: string; summary?: string; description?: string; method?: string; path?: string; kind?: string; requiredScopes?: string[] };
  params: Record<string, unknown>;
  hash: string;
  expires_at: string;
  connection_revision: string;
};
export type ChatRun = {
  id: string;
  question: string;
  status: "queued" | "running" | "awaiting_confirmation" | "execute_queued" | "executing" | "done" | "failed" | "unknown" | "rejected";
  answer: string;
  plan: Record<string, unknown>;
  proposal: Partial<ChatProposal>;
  evidence: Record<string, unknown>[];
  limitations: string[];
  account_snapshot: Record<string, unknown>;
  rows?: Record<string, unknown>[];
  row_count?: number;
  rows_truncated?: boolean;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  export_error: string;
  csv_url?: string | null;
  pdf_url?: string | null;
};
export type ChatDetail = ChatConversation & { runs: ChatRun[]; page?: number; has_more?: boolean; run_count?: number };

export function prependHistory(current: ChatDetail, older: ChatDetail): ChatDetail {
  if (current.id !== older.id || current.account_id !== older.account_id) return current;
  const loaded = new Set(current.runs.map((run) => run.id));
  return { ...current, page: older.page, has_more: older.has_more,
    run_count: Math.max(current.run_count ?? current.runs.length, older.run_count ?? older.runs.length),
    runs: [...older.runs.filter((run) => !loaded.has(run.id)), ...current.runs] };
}

export function isWorking(status: ChatRun["status"]): boolean {
  return ["queued", "running", "execute_queued", "executing"].includes(status);
}

export function hasOutstandingRun(runs: ChatRun[]): boolean {
  return runs.some((run) => isWorking(run.status) || run.status === "awaiting_confirmation");
}

export function cellText(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
