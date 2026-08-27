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
export type ChatDetail = ChatConversation & { runs: ChatRun[] };

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
