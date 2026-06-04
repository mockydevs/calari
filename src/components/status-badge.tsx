import { Badge } from "@/components/ui/badge";

const buildColors: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  AI_DRAFTED: "bg-violet-100 text-violet-700",
  ASSIGNED: "bg-blue-100 text-blue-700",
  IN_PROGRESS: "bg-amber-100 text-amber-700",
  READY_FOR_REVIEW: "bg-indigo-100 text-indigo-700",
  CHANGES_REQUESTED: "bg-orange-100 text-orange-700",
  DELIVERED: "bg-emerald-100 text-emerald-700",
};
const taskColors: Record<string, string> = {
  TODO: "bg-slate-100 text-slate-700",
  IN_PROGRESS: "bg-amber-100 text-amber-700",
  BLOCKED: "bg-red-100 text-red-700",
  DONE: "bg-emerald-100 text-emerald-700",
};

export function StatusBadge({ status, kind = "build" }: { status: string; kind?: "build" | "task" }) {
  const map = kind === "task" ? taskColors : buildColors;
  return <Badge className={map[status] ?? "bg-slate-100 text-slate-700"}>{status.replace(/_/g, " ")}</Badge>;
}
