import * as React from "react";
import { cn, initials } from "@/lib/portal/format";
import {
  PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  TASK_STATUS_LABELS,
  USER_ROLE_LABELS,
  type Priority,
  type ProjectStatus,
  type TaskStatus,
  type UserRole,
} from "@/lib/portal/types";

// ── Generic badge ────────────────────────────────────────────────────────────
export function Badge({
  tone,
  className,
  children,
}: {
  tone: string;
  className?: string;
  children: React.ReactNode;
}) {
  return <span className={cn("portal-badge", `portal-badge-${tone}`, className)}>{children}</span>;
}

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge tone={status}>{PROJECT_STATUS_LABELS[status] ?? status}</Badge>;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Badge tone={status}>{TASK_STATUS_LABELS[status] ?? status}</Badge>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge tone={priority}>{PRIORITY_LABELS[priority] ?? priority}</Badge>;
}

export function RoleBadge({ role }: { role: UserRole }) {
  return <Badge tone={role}>{USER_ROLE_LABELS[role] ?? role}</Badge>;
}

// ── Priority pill (compact, for kanban/dash rows) ─────────────────────────────
export function PriorityPill({ priority }: { priority: Priority }) {
  return (
    <span className={cn("portal-priority-pill", `portal-pr-${priority}`)}>
      {PRIORITY_LABELS[priority]?.toUpperCase() ?? priority}
    </span>
  );
}

export function StatusDot({ status }: { status: TaskStatus }) {
  return <span className={cn("portal-status-dot", `portal-dot-${status}`)} />;
}

// ── Avatars ──────────────────────────────────────────────────────────────────
const SIZES = { xs: 22, sm: 26, md: 30, lg: 36 } as const;

export function Avatar({
  name,
  size = "md",
  className,
}: {
  name?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const px = SIZES[size];
  return (
    <span
      className={cn("portal-avatar", className)}
      style={{ width: px, height: px, fontSize: px * 0.38 }}
      title={name ?? undefined}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({
  names,
  max = 4,
  size = "xs",
}: {
  names: (string | null | undefined)[];
  max?: number;
  size?: keyof typeof SIZES;
}) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <div className="portal-avatar-stack items-center">
      {shown.map((n, i) => (
        <Avatar key={i} name={n} size={size} />
      ))}
      {extra > 0 && <span className="portal-text-muted ml-1.5 text-[0.65rem]">+{extra}</span>}
    </div>
  );
}

// ── Progress ─────────────────────────────────────────────────────────────────
export function ProgressBar({ percent, className }: { percent: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(percent || 0)));
  return (
    <div className={cn("portal-progress", className)}>
      <div className="portal-progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── Cards ────────────────────────────────────────────────────────────────────
export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("portal-card p-4", className)}>{children}</div>;
}

export function StatCard({
  icon,
  value,
  label,
  accent = "var(--accent-primary)",
}: {
  icon: React.ReactNode;
  value: React.ReactNode;
  label: string;
  accent?: string;
}) {
  return (
    <div className="portal-stat-card" style={{ borderLeftColor: accent }}>
      <span
        className="portal-stat-icon"
        style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="portal-stat-value">{value}</div>
        <div className="portal-stat-label">{label}</div>
      </div>
    </div>
  );
}

// ── States ───────────────────────────────────────────────────────────────────
export function EmptyState({ icon, message }: { icon?: React.ReactNode; message: string }) {
  return (
    <div className="portal-empty">
      {icon && <div className="mb-2 flex justify-center opacity-50">{icon}</div>}
      <p>{message}</p>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("portal-skeleton", className)} />;
}

export function SectionTitle({
  icon,
  children,
  action,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h3 className="flex items-center gap-1.5 text-[0.72rem] font-bold uppercase tracking-wide">
        {icon}
        {children}
      </h3>
      {action}
    </div>
  );
}
