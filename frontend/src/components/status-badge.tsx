import { cn } from "@/lib/utils";

interface StatusConfig {
  dot: string;
  bg: string;
  text: string;
  label: string;
}

const buildConfig: Record<string, StatusConfig> = {
  DRAFT: { dot: "bg-slate-400", bg: "bg-slate-100", text: "text-slate-600", label: "Draft" },
  AI_DRAFTED: { dot: "bg-violet-500", bg: "bg-violet-50", text: "text-violet-700", label: "AI Drafted" },
  ASSIGNED: { dot: "bg-cyan-500", bg: "bg-cyan-50", text: "text-cyan-700", label: "Assigned" },
  IN_PROGRESS: { dot: "bg-amber-500", bg: "bg-amber-50", text: "text-amber-700", label: "In Progress" },
  READY_FOR_REVIEW: { dot: "bg-indigo-500", bg: "bg-indigo-50", text: "text-indigo-700", label: "Ready for Review" },
  CHANGES_REQUESTED: { dot: "bg-orange-500", bg: "bg-orange-50", text: "text-orange-700", label: "Changes Requested" },
  DELIVERED: { dot: "bg-emerald-500", bg: "bg-emerald-50", text: "text-emerald-700", label: "Delivered" },
};

const taskConfig: Record<string, StatusConfig> = {
  TODO: { dot: "bg-slate-400", bg: "bg-slate-100", text: "text-slate-600", label: "To Do" },
  IN_PROGRESS: { dot: "bg-amber-500", bg: "bg-amber-50", text: "text-amber-700", label: "In Progress" },
  BLOCKED: { dot: "bg-red-500", bg: "bg-red-50", text: "text-red-700", label: "Blocked" },
  DONE: { dot: "bg-emerald-500", bg: "bg-emerald-50", text: "text-emerald-700", label: "Done" },
};

export function StatusBadge({ status, kind = "build" }: { status: string; kind?: "build" | "task" }) {
  const config = (kind === "task" ? taskConfig : buildConfig)[status];
  const label = config?.label ?? status.replace(/_/g, " ");
  const bg = config?.bg ?? "bg-slate-100";
  const text = config?.text ?? "text-slate-600";
  const dot = config?.dot ?? "bg-slate-400";

  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ring-black/[0.03]", bg, text)}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
      {label}
    </span>
  );
}
