import Link from "next/link";
import { GenerateSopButton } from "./ai-buttons";
import { ConfirmDeleteButton } from "./build-row-actions";
import { deleteTask, reassignTask, updateTaskStatus } from "./actions";
import { TASK_STATUSES, TASK_STATUS_LABEL, TASK_TYPE_LABEL, type BuildTask, type DjangoUser } from "./_shared";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ClientContext } from "../tasks/client-context";
import { Textarea } from "@/components/ui/textarea";
import { GhlVerification } from "../tasks/ghl-verification";

/**
 * A single build task, presented as a card with its own rows for identity,
 * description, and controls — rather than cramming title + type + every
 * action into one line. Shared by the per-build Tasks tab and the cross-build
 * /tasks page so both stay visually consistent.
 */
export function TaskCard({
  task, buildId, canManage, canManageBuilds, users, showBuildLink,
}: {
  task: BuildTask;
  buildId: number | string;
  canManage: boolean;
  canManageBuilds: boolean;
  users: DjangoUser[];
  showBuildLink?: boolean;
}) {
  return (
    <li className="rounded-lg bg-white p-5 transition-colors hover:bg-slate-50/40">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-slate-900">{task.title}</p>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {TASK_TYPE_LABEL[task.type] || task.type}
            </span>
          </div>
          {showBuildLink && buildId ? (
            <Link href={`/builds/${buildId}`} className="mt-0.5 inline-block text-xs font-medium text-pink-700 hover:underline">
              {task.client_name || task.build_title}
            </Link>
          ) : showBuildLink ? <p className="mt-1 text-xs text-slate-500">{task.slack_intake ? "Slack assignment · private team workspace" : "Internal task"}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-md px-2 py-1 font-medium ${task.priority === "URGENT" || task.priority === "HIGH" ? "bg-orange-50 text-orange-700" : "bg-slate-100 text-slate-500"}`}>{(task.priority || "MEDIUM").toLowerCase()} priority</span>
          {task.due_date && <span className="text-slate-500">Due {new Date(task.due_date).toLocaleDateString("en-GB", { month: "short", day: "numeric", timeZone: "Africa/Nairobi" })}</span>}
          <span className={`rounded-md px-2 py-1 font-medium ${task.status === 'DONE' ? 'bg-emerald-50 text-emerald-700' : task.status === 'BLOCKED' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{TASK_STATUS_LABEL[task.status]}</span>
        </div>
      </div>

      {task.description && (
        <details className="mt-3 text-sm text-slate-600"><summary className="cursor-pointer text-xs text-slate-500">View instructions</summary><div className="mt-2 rounded-md bg-slate-50 p-3 text-xs leading-relaxed whitespace-pre-wrap text-slate-700">
          {task.description}
        </div></details>
      )}

      {(task.slack_intake || buildId) && <ClientContext taskId={task.id} slack={!!task.slack_intake} />}
      {task.status === "DONE" && <GhlVerification key={`${task.id}-${task.ghl_verification_status}-${task.ghl_verification_checked_at}`} taskId={task.id} canRetry={canManage} initial={{ status: task.ghl_verification_status || "", note: task.ghl_verification_note || "", checked_at: task.ghl_verification_checked_at }} />}
      <details className="mt-3"><summary className="cursor-pointer text-xs text-slate-500">{task.assignee_name || "Unassigned"}{canManage ? " · Manage task" : " · Details"}</summary>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 pt-2.5">
        {canManageBuilds && users.length > 0 ? (
          <form key={`assignee-${task.assignee ?? "none"}`} action={reassignTask} className="flex items-center gap-2">
            <input type="hidden" name="taskId" value={task.id} /><input type="hidden" name="buildId" value={buildId} />
            <span className="text-xs text-slate-400">Assignee</span>
            <Select name="assignee" aria-label={`Assignee for ${task.title}`} defaultValue={task.assignee != null ? String(task.assignee) : ""} className="h-8 text-xs">
              <option value="">Unassigned</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
            </Select>
            <Button type="submit" size="sm" variant="outline">Save</Button>
          </form>
        ) : (
          task.assignee_name && (
            <span className="text-xs text-slate-500">Assigned to <span className="font-medium text-slate-700">{task.assignee_name}</span></span>
          )
        )}

        {canManage ? (
          <form key={`status-${task.status}`} action={updateTaskStatus} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="taskId" value={task.id} /><input type="hidden" name="buildId" value={buildId} />
            <span className="text-xs text-slate-400">Status</span>
            <Select name="status" aria-label={`Status for ${task.title}`} defaultValue={task.status} className="h-8 text-xs">
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
            </Select>
            <label className="w-full space-y-1 text-xs text-slate-500">Completion evidence or progress note<Textarea name="progressNote" defaultValue={task.progress_note || ""} rows={3} maxLength={4000} placeholder="Describe what changed, exact GHL item names, and tests performed. This stays in the portal." /></label>
            <Button type="submit" size="sm" variant="outline">Set</Button>
          </form>
        ) : (
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{TASK_STATUS_LABEL[task.status]}</span>
        )}

        {canManageBuilds && !task.slack_intake && (
          <ConfirmDeleteButton
            action={deleteTask} fields={{ taskId: task.id, buildId }}
            title="Delete task" message={`Delete task "${task.title}"?`} label="Delete"
          />
        )}
      </div>
      {canManageBuilds && buildId && <div className="mt-3"><GenerateSopButton buildId={buildId} taskId={task.id} hasDescription={Boolean(task.description)} /></div>}
      </details>
    </li>
  );
}
