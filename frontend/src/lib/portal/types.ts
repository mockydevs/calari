/**
 * Calari Staff Portal — Django API domain types.
 * Hand-written from the DRF serializer inventory (see scripts/openapi.yaml).
 * The portal consumes Django as the backend of record; these mirror its JSON shapes.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────
export type UserRole = "superuser" | "admin" | "employee" | "finance";
export type EffectiveRole = "superuser" | "admin" | "viewer";
export type ProjectStatus = "active" | "on_hold" | "completed" | "cancelled";
export type Priority = "low" | "medium" | "high" | "critical";
export type TaskStatus = "todo" | "in_progress" | "in_review" | "done";
export type CoAssignRole =
  | "lead"
  | "developer"
  | "designer"
  | "tester"
  | "reviewer"
  | "observer";

export const PROJECT_STATUSES: ProjectStatus[] = ["active", "on_hold", "completed", "cancelled"];
export const PRIORITIES: Priority[] = ["low", "medium", "high", "critical"];
export const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "in_review", "done"];
export const CO_ASSIGN_ROLES: CoAssignRole[] = [
  "lead",
  "developer",
  "designer",
  "tester",
  "reviewer",
  "observer",
];

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
export const USER_ROLE_LABELS: Record<UserRole, string> = {
  superuser: "Superuser",
  admin: "Admin",
  employee: "Employee",
  finance: "Finance",
};

// ─── Users / Auth ────────────────────────────────────────────────────────────
export interface User {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: UserRole;
  effective_role: EffectiveRole;
  is_active: boolean;
  is_superuser: boolean;
  job_title: string;
  date_joined: string;
  last_login: string | null;
  last_login_ip: string | null;
  profile_notes: string;
}

// ─── Clients ─────────────────────────────────────────────────────────────────
export interface Client {
  id: number;
  name: string;
  email: string;
  phone_number: string;
  company_name: string;
  created_at: string;
  is_active: boolean;
}

// ─── Projects ────────────────────────────────────────────────────────────────
export interface ProjectMilestone {
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

export interface ProjectContactPerson {
  id: number;
  project: number;
  name: string;
  email: string;
  phone_number: string;
  role: string;
}

export interface ProjectBlocker {
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

export interface ProjectCoAssignment {
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

export interface ProjectFile {
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

export interface ProjectProgress {
  total: number;
  done: number;
  percent: number;
  overdue_count?: number;
  milestone_count?: number;
}

// ─── Tasks ───────────────────────────────────────────────────────────────────
export interface TaskLabel {
  id: number;
  name: string;
  color: string;
  created_by?: number | null;
}

export interface TaskComment {
  id: number;
  task: number;
  author: number | null;
  author_name?: string;
  author_initials?: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface TaskFile {
  id: number;
  task: number;
  file_name: string;
  file: string;
  uploaded_by: number | null;
  uploaded_by_name?: string;
  uploaded_at: string;
}

export interface TaskBlocker {
  id: number;
  task: number;
  description: string;
  attachment: string | null;
  reported_by: number | null;
  reported_by_name?: string;
  created_at: string;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: number | null;
  resolved_by_name?: string;
  task_name?: string;
  project_name?: string;
}

export interface TaskChecklistItem {
  id: number;
  task: number;
  title: string;
  completed: boolean;
  completed_by: number | null;
  completed_by_name?: string;
  completed_at: string | null;
  order: number;
}

export interface TaskActivity {
  id: number;
  task: number;
  user: number | null;
  user_name?: string;
  user_initials?: string;
  action: string;
  detail: string;
  created_at: string;
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

export interface Task extends TaskCard {
  estimated_hours: string | null;
  actual_hours: string | null;
  created_at: string;
  created_by: number | null;
  created_by_name?: string;
  completed_at: string | null;
  completed_by: number | null;
  files?: TaskFile[];
  blockers?: TaskBlocker[];
  comments?: TaskComment[];
  checklist?: TaskChecklistItem[];
}

/** Response of GET /api/projects/tasks/board/{project_id}/ */
export interface TaskBoard {
  project_name?: string;
  todo: TaskCard[];
  in_progress: TaskCard[];
  in_review: TaskCard[];
  done: TaskCard[];
}

// ─── Dashboards ──────────────────────────────────────────────────────────────
export interface MyDashboard {
  stats: {
    my_active_projects: number;
    my_open_tasks: number;
    my_overdue_tasks: number;
    my_high_priority_tasks: number;
  };
  almost_due_tasks: TaskCard[];
  my_tasks: TaskCard[];
  high_priority_tasks: TaskCard[];
  overdue_tasks: TaskCard[];
  upcoming_milestones: ProjectMilestone[];
  active_blockers: ProjectBlocker[];
  recent_activity: ProjectActivity[];
}

export interface DashboardStats {
  projects: {
    total: number;
    active: number;
    completed: number;
    on_hold: number;
    overdue: number;
    cancelled: number;
  };
  clients: { total: number; active: number };
  tasks: { total: number; pending: number; completed: number };
  users: {
    total: number;
    active: number;
    inactive: number;
    superusers: number;
    admins: number;
  };
  blockers: { project_open: number; task_open: number };
  recent_projects?: Project[];
  recent_tasks?: TaskCard[];
  recent_clients?: Client[];
  staff_workload?: { user: string; initials?: string; open_tasks: number }[];
}

/** Standard DRF field-error envelope. */
export type ApiErrorBody =
  | { detail?: string; error?: string; non_field_errors?: string[] }
  | Record<string, string[] | string>;
