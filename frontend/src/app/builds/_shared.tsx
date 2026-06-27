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

export type ChangeRequestStatus =
  | "PENDING"
  | "APPROVED"
  | "IN_BUILD"
  | "BLOCKED"
  | "DEFERRED"
  | "REJECTED"
  | "IMPLEMENTED";
export interface ChangeRequest {
  id: number;
  title: string;
  description: string;
  impact: string;
  status: ChangeRequestStatus;
  requester: string;
  owner: number | null;
  owner_name?: string | null;
  due_date: string | null;
  blocker_note: string;
  blocker_attachment_url: string;
  blocker_attachment_name: string;
  blocked_by_name?: string | null;
  implemented_by_name?: string | null;
  blocked_at: string | null;
  implemented_at: string | null;
  implementation_steps: string;
  created_by_name?: string;
  created_at: string;
}
export interface Approval { id: number; type: string; note: string; approver_name?: string; created_at: string }
export interface BuildComment { id: number; body: string; author_name?: string; created_at: string }
export interface BuildDocument { id: number; filename: string; url: string; uploaded_by_name?: string; created_at: string }
export interface BuildActivity { id: number; actor: string; message: string; created_at: string }
export interface MeetingNote {
  id: number; raw_text: string; source: string; ai_status: string; created_at: string;
  kind?: string; title?: string; meeting_date?: string | null;
}
export const MEETING_NOTE_KIND_LABEL: Record<string, string> = {
  kickoff: "Kickoff", meeting: "Meeting notes", progress: "Progress update",
  change_request: "Client-requested update", other: "Note",
};
export interface MemorySnapshot { id: number; summary: string; scope_changes: string; created_by_name?: string; created_by_ai: boolean; created_at: string }
export type BuildSectionKey =
  | "PIPELINE"
  | "AUTOMATIONS"
  | "CLIENT_UPDATES"
  | "LEAD_SOURCES"
  | "CALENDARS"
  | "INTEGRATIONS"
  | "FIELDS_TAGS"
  | "FORMS_PAYMENTS"
  | "REPORTING_LAUNCH";
export type BuildSectionReviewStatus = "TODO" | "DONE" | "BLOCKED";
export interface BuildSectionReview {
  id: number;
  build: number;
  section: BuildSectionKey;
  status: BuildSectionReviewStatus;
  blocker_note: string;
  blocker_attachment_url: string;
  blocker_attachment_name: string;
  blocker_history: {
    note?: string;
    attachment_url?: string;
    attachment_name?: string;
    user_name?: string;
    created_at?: string;
  }[];
  completed_by_name?: string | null;
  blocked_by_name?: string | null;
  completed_at: string | null;
  blocked_at: string | null;
  updated_at: string;
}

// ─── Meeting tasklist (source-faithful capture) ──────────────────────────────
export type ActionItemCategory = "REQUEST" | "CHANGE" | "QUESTION" | "DECISION" | "INFO";
export type ActionItemStatus = "OPEN" | "IN_PROGRESS" | "DONE" | "DROPPED";
export const ACTION_ITEM_CATEGORIES: ActionItemCategory[] = ["REQUEST", "CHANGE", "QUESTION", "DECISION", "INFO"];
export const ACTION_ITEM_CATEGORY_LABEL: Record<ActionItemCategory, string> = {
  REQUEST: "Request", CHANGE: "Change", QUESTION: "Question", DECISION: "Decision", INFO: "Info",
};
export const ACTION_ITEM_STATUSES: ActionItemStatus[] = ["OPEN", "IN_PROGRESS", "DONE", "DROPPED"];
export const ACTION_ITEM_STATUS_LABEL: Record<ActionItemStatus, string> = {
  OPEN: "Open", IN_PROGRESS: "In progress", DONE: "Done", DROPPED: "Dropped",
};
// GHL-section display order + labels for grouping the tasklist ("" = uncategorized).
export const ACTION_ITEM_SECTIONS: { key: BuildSectionKey | ""; label: string }[] = [
  { key: "PIPELINE", label: "Pipeline" },
  { key: "AUTOMATIONS", label: "Automations" },
  { key: "CLIENT_UPDATES", label: "New features & updates" },
  { key: "LEAD_SOURCES", label: "Lead sources" },
  { key: "CALENDARS", label: "Calendars" },
  { key: "INTEGRATIONS", label: "Integrations" },
  { key: "FIELDS_TAGS", label: "Fields & tags" },
  { key: "FORMS_PAYMENTS", label: "Forms & payments" },
  { key: "REPORTING_LAUNCH", label: "Reporting & launch" },
  { key: "", label: "Other / uncategorized" },
];
export type ActionItemVerification = "UNVERIFIED" | "VERIFIED" | "NEEDS_INFO";
export const ACTION_ITEM_VERIFICATION_LABEL: Record<ActionItemVerification, string> = {
  UNVERIFIED: "Unverified", VERIFIED: "Verified", NEEDS_INFO: "Needs info",
};
export interface MeetingActionItem {
  id: number;
  build: number;
  text: string;
  detail: string;
  category: ActionItemCategory;
  section: BuildSectionKey | "";
  status: ActionItemStatus;
  superseded: boolean;
  superseded_reason: string;
  verification: ActionItemVerification;
  evidence: string;
  verification_note: string;
  locked: boolean;
  ai_generated: boolean;
  order: number;
  introduced_in_title?: string | null;
  last_changed_in_title?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProgressReport {
  id: number;
  build: number;
  source: string;
  raw_text: string;
  file_url: string;
  ai_status: "pending" | "processing" | "done" | "failed";
  summary: string;
  pushback: string[];
  verified_count: number;
  needs_info_count: number;
  created_by_name?: string | null;
  created_at: string;
}

export const CHANGE_REQUEST_STATUSES: ChangeRequestStatus[] = [
  "PENDING",
  "APPROVED",
  "IN_BUILD",
  "DEFERRED",
  "REJECTED",
  "IMPLEMENTED",
];
export const CHANGE_REQUEST_STATUS_LABEL: Record<ChangeRequestStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  IN_BUILD: "In build",
  BLOCKED: "Blocked",
  DEFERRED: "Deferred",
  REJECTED: "Rejected",
  IMPLEMENTED: "Implemented",
};
export const APPROVAL_TYPES = ["BRIEF", "CHANGE_REQUEST", "DELIVERY", "CLIENT"] as const;

export interface BuildDetail extends BuildRow {
  goals: string;
  integrations: string;
  overview?: string;
  one_line_summary?: string;
  maintenance_notes?: string;
  creator_name?: string;
  client_portal_enabled?: boolean;
  client_portal_token?: string | null;
  tasks?: BuildTask[];
  documents?: BuildDocument[];
  comments?: BuildComment[];
  change_requests?: ChangeRequest[];
  approvals?: Approval[];
  section_reviews?: BuildSectionReview[];
  activities?: BuildActivity[];
  memory_snapshots?: MemorySnapshot[];
  action_items?: MeetingActionItem[];
  progress_reports?: ProgressReport[];
  tasklist_status?: string;
  build_document?: string;
  build_document_at?: string | null;
}

export function BuildStatusBadge({ status }: { status: BuildStatus }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${BUILD_STATUS_STYLE[status] ?? "bg-slate-100 text-slate-600 ring-slate-200"}`}>
      {BUILD_STATUS_LABEL[status] ?? status}
    </span>
  );
}
