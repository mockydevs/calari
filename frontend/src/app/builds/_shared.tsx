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

export interface ContactSource {
  id: number; type: string; label: string;
  entry_mechanism?: string; fires?: string; tags_applied?: string;
  handling_workflow?: string; entry_stage?: number | null; notes?: string;
  inferred?: boolean; confidence?: string;
}
export interface ManualAction { id: number; description: string; owner: string }
export interface PipelineStage {
  id: number; name: string; description: string; order: number;
  entry_condition?: string; is_automatic?: boolean; manual_actions: ManualAction[];
  inferred?: boolean; confidence?: string;
}

/** Small "AI inferred this — review it" chip. Renders nothing for items read
 * straight from the notes (inferred=false), which need no scrutiny flag. */
export function ProvBadge({ inferred, confidence }: { inferred?: boolean; confidence?: string }) {
  if (!inferred) return null;
  return (
    <span
      title="The AI inferred this (not stated in the notes) — review it"
      className="inline-flex items-center rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700 ring-1 ring-inset ring-amber-200"
    >
      Inferred{confidence ? ` · ${confidence}` : ""}
    </span>
  );
}

export const CALENDAR_TYPE_LABEL: Record<string, string> = {
  ROUND_ROBIN: "Round robin", COLLECTIVE: "Collective", CLASS: "Class / group",
  SERVICE: "Service", PERSONAL: "Personal", OTHER: "Other",
};
export interface Calendar {
  id: number; name: string; type: string; purpose: string; assigned_to: string;
  books_into_stage: number | null; on_booking: string; reminders: string; notes: string;
  inferred?: boolean; confidence?: string;
}

export const INTEGRATION_DIRECTION_LABEL: Record<string, string> = {
  INBOUND: "Inbound → GHL", OUTBOUND: "GHL → Out", BIDIRECTIONAL: "Bidirectional",
};
export const INTEGRATION_DIRECTION_STYLE: Record<string, string> = {
  INBOUND: "bg-sky-50 text-sky-700", OUTBOUND: "bg-violet-50 text-violet-700",
  BIDIRECTIONAL: "bg-emerald-50 text-emerald-700",
};
export const INTEGRATION_MECHANISM_LABEL: Record<string, string> = {
  API: "API", WEBHOOK: "Webhook", NATIVE: "Native", ZAPIER: "Zapier / Make",
  CRON: "Scheduled sync", OTHER: "Other",
};
export interface Integration {
  id: number; name: string; direction: string; mechanism: string;
  data_objects: string; purpose: string; trigger_cadence: string; notes: string;
  inferred?: boolean; confidence?: string;
}

export interface StageTransition {
  id: number; from_stage: number | null; to_stage: number | null;
  from_label: string; to_label: string; trigger: string; is_automatic: boolean; notes: string;
}
export const WORKFLOW_CATEGORY_LABEL: Record<string, string> = {
  ACTIVE_CONVERSION: "Active conversion (A)",
  INTAKE_ROUTING: "Intake & routing (IN)",
  RECORD_KEEPING: "Record-keeping (REC)",
  APPOINTMENT_LIFECYCLE: "Appointment lifecycle (E, K)",
  POST_VISIT: "Post-visit & retention (G)",
  INTERNAL_UTILITY: "Internal & utility (H, X, Y, Z)",
  OTHER: "Other",
};
export interface Workflow {
  id: number; code: string; category: string; name: string;
  trigger: string; what_it_does: string; patient_facing: boolean;
  inferred?: boolean; confidence?: string;
}
export interface CustomField { id: number; kind: "FIELD" | "VALUE"; key: string; description: string; populated: boolean }
export interface TagDefinition { id: number; tag: string; meaning: string }
export interface PreLaunchItem { id: number; description: string; optional: boolean; done: boolean }

export type GapStatus = "OPEN" | "ANSWERED" | "DISMISSED";
export type GapSeverity = "high" | "medium" | "low";
export const GAP_CATEGORY_LABEL: Record<string, string> = {
  OVERVIEW: "Overview", STAGE: "Stage", TRANSITION: "Stage movement",
  LEAD_SOURCE: "Lead source", CALENDAR: "Calendar", INTEGRATION: "Integration",
  WORKFLOW: "Workflow", CUSTOM_FIELD: "Custom field", TAG: "Tag", GENERAL: "General",
};
export const GAP_SEVERITY_STYLE: Record<GapSeverity, string> = {
  high: "bg-red-50 text-red-700 ring-red-200",
  medium: "bg-amber-50 text-amber-700 ring-amber-200",
  low: "bg-slate-100 text-slate-600 ring-slate-200",
};
export interface VisionGap {
  id: number; category: string; question: string; rationale: string;
  severity: GapSeverity; status: GapStatus; answer: string;
  resolved_by_name?: string | null; created_at: string;
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
  contact_sources?: ContactSource[];
  calendars?: Calendar[];
  external_integrations?: Integration[];
  stages?: PipelineStage[];
  transitions?: StageTransition[];
  workflows?: Workflow[];
  custom_fields?: CustomField[];
  tags?: TagDefinition[];
  pre_launch_items?: PreLaunchItem[];
  gaps?: VisionGap[];
  documents?: BuildDocument[];
  comments?: BuildComment[];
  change_requests?: ChangeRequest[];
  approvals?: Approval[];
  section_reviews?: BuildSectionReview[];
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
