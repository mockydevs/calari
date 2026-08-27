/** Django API types used by the staff portal. */
export type ProjectStatus = "active" | "on_hold" | "completed" | "cancelled";
export type Priority = "low" | "medium" | "high" | "critical";
export type TaskStatus = "todo" | "in_progress" | "in_review" | "done";
type CoAssignRole =
  | "lead"
  | "developer"
  | "designer"
  | "tester"
  | "reviewer"
  | "observer";

export const PROJECT_STATUSES: ProjectStatus[] = ["active", "on_hold", "completed", "cancelled"];
export const PRIORITIES: Priority[] = ["low", "medium", "high", "critical"];
export const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "in_review", "done"];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: "Active",
  on_hold: "On Hold",
  completed: "Completed",
  cancelled: "Cancelled",
};
export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

// ─── Projects ────────────────────────────────────────────────────────────────
interface ProjectMilestone {
  id: number;
  project: number;
  name: string;
  description: string;
  due_date: string;
  completed: boolean;
  completed_at: string | null;
  created_by: number | null;
  created_by_name?: string;
  created_at: string;
}

interface ProjectContactPerson {
  id: number;
  project: number;
  name: string;
  email: string;
  phone_number: string;
  role: string;
}

interface ProjectBlocker {
  id: number;
  project: number;
  description: string;
  attachment: string | null;
  reported_by: number | null;
  reported_by_name?: string;
  created_at: string;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: number | null;
  resolved_by_name?: string;
  project_name?: string;
}

interface ProjectCoAssignment {
  id: number;
  project: number;
  user: number;
  role: CoAssignRole;
  user_name?: string;
  user_initials?: string;
  assigned_by: number | null;
  assigned_by_name?: string;
  assigned_at: string;
}

interface ProjectFile {
  id: number;
  project: number;
  file_name: string;
  file: string;
  uploaded_by: number | null;
  uploaded_by_name?: string;
  uploaded_at: string;
}

export interface ProjectActivity {
  id: number;
  project: number;
  user: number | null;
  user_name?: string;
  user_initials?: string;
  action: string;
  detail: string;
  created_at: string;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  status: ProjectStatus;
  priority: Priority;
  budget: string | null;
  start_date: string;
  end_date: string;
  client: number | null;
  client_name?: string;
  assigned_to: number | null;
  assigned_to_name?: string;
  assigned_to_initials?: string;
  created_at: string;
  progress_percent?: number;
  // Nested (present on detail retrieve)
  files?: ProjectFile[];
  contacts?: ProjectContactPerson[];
  blockers?: ProjectBlocker[];
  tasks?: TaskCard[];
  co_assignments?: ProjectCoAssignment[];
  milestones?: ProjectMilestone[];
}

// ─── Tasks ───────────────────────────────────────────────────────────────────
interface TaskLabel {
  id: number;
  name: string;
  color: string;
  created_by?: number | null;
}

/** Lightweight task shape used on boards / project nesting. */
export interface TaskCard {
  id: number;
  project: number;
  name: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  assigned_to: number | null;
  assigned_to_name?: string;
  assigned_to_initials?: string;
  due_date: string | null;
  labels?: TaskLabel[];
  checklist_total?: number;
  checklist_done?: number;
  comment_count?: number;
  completed?: boolean;
}

/** Response of GET /api/projects/tasks/board/{project_id}/ */
export interface TaskBoard {
  project_name?: string;
  todo: TaskCard[];
  in_progress: TaskCard[];
  in_review: TaskCard[];
  done: TaskCard[];
}

/** Standard DRF field-error envelope. */
export type ApiErrorBody =
  | { detail?: string; error?: string; non_field_errors?: string[] }
  | Record<string, string[] | string>;
