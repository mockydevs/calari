// Shared types + presentational helpers for the Django-backed Builds module.

export type BuildStatus =
  | "DRAFT"
  | "AI_DRAFTED"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "READY_FOR_REVIEW"
  | "CHANGES_REQUESTED"
  | "DELIVERED";

export const BUILD_STATUSES: BuildStatus[] = [
  "DRAFT",
  "AI_DRAFTED",
  "ASSIGNED",
  "IN_PROGRESS",
  "READY_FOR_REVIEW",
  "CHANGES_REQUESTED",
  "DELIVERED",
];

export const BUILD_STATUS_LABEL: Record<BuildStatus, string> = {
  DRAFT: "Draft",
  AI_DRAFTED: "AI Drafted",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In Progress",
  READY_FOR_REVIEW: "Ready for Review",
  CHANGES_REQUESTED: "Changes Requested",
  DELIVERED: "Delivered",
};

const BUILD_STATUS_STYLE: Record<BuildStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-600 ring-slate-200",
  AI_DRAFTED: "bg-violet-50 text-violet-700 ring-violet-200",
  ASSIGNED: "bg-pink-50 text-pink-700 ring-pink-200",
  IN_PROGRESS: "bg-amber-50 text-amber-700 ring-amber-200",
  READY_FOR_REVIEW: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  CHANGES_REQUESTED: "bg-orange-50 text-orange-700 ring-orange-200",
  DELIVERED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

export type TaskStatus = "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE";
export const TASK_STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  BLOCKED: "Blocked",
  DONE: "Done",
};
export const TASK_TYPES = ["AUTOMATION", "FUNNEL", "FORM", "INTEGRATION", "OTHER"] as const;

export interface BuildRow {
  id: number;
  title: string;
  status: BuildStatus;
  client: number | null;
  client_name?: string;
  assignee: number | null;
  assignee_name?: string;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface BuildTask {
  id: number;
  title: string;
  description: string;
  type: string;
  status: TaskStatus;
  assignee_name?: string;
  due_date: string | null;
}

export interface ContactSource { id: number; type: string; label: string }
export interface ManualAction { id: number; description: string; owner: string }
export interface PipelineStage { id: number; name: string; description: string; order: number; manual_actions: ManualAction[] }
export interface ChangeRequest { id: number; title: string; description: string; impact: string; status: string; created_by_name?: string; created_at: string }
export interface Approval { id: number; type: string; note: string; approver_name?: string; created_at: string }
export interface BuildComment { id: number; body: string; author_name?: string; created_at: string }
export interface BuildDocument { id: number; filename: string; url: string; uploaded_by_name?: string; created_at: string }
export interface BuildActivity { id: number; actor: string; message: string; created_at: string }
export interface MeetingNote { id: number; raw_text: string; source: string; ai_status: string; created_at: string }
export interface MemorySnapshot { id: number; summary: string; scope_changes: string; created_by_name?: string; created_by_ai: boolean; created_at: string }

export const CHANGE_REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED", "IMPLEMENTED"] as const;
export const APPROVAL_TYPES = ["BRIEF", "CHANGE_REQUEST", "DELIVERY", "CLIENT"] as const;

export interface BuildDetail extends BuildRow {
  goals: string;
  integrations: string;
  creator_name?: string;
  client_portal_enabled?: boolean;
  client_portal_token?: string | null;
  tasks?: BuildTask[];
  contact_sources?: ContactSource[];
  stages?: PipelineStage[];
  documents?: BuildDocument[];
  comments?: BuildComment[];
  change_requests?: ChangeRequest[];
  approvals?: Approval[];
  activities?: BuildActivity[];
  memory_snapshots?: MemorySnapshot[];
}

export function BuildStatusBadge({ status }: { status: BuildStatus }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${BUILD_STATUS_STYLE[status] ?? "bg-slate-100 text-slate-600 ring-slate-200"}`}>
      {BUILD_STATUS_LABEL[status] ?? status}
    </span>
  );
}
