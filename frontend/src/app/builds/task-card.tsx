import Link from "next/link";
import { GenerateSopButton } from "./ai-buttons";
import { ConfirmDeleteButton } from "./build-row-actions";
import { deleteTask, reassignTask, updateTaskStatus } from "./actions";
import { TASK_STATUSES, TASK_STATUS_LABEL, type BuildTask, type DjangoUser } from "./_shared";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

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
    <li className="rounded-md border border-slate-200 bg-white p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-slate-900">{task.title}</p>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {task.type}
            </span>
          </div>
          {showBuildLink && (
            <Link href={`/builds/${buildId}`} className="mt-0.5 inline-block text-xs font-medium text-pink-700 hover:underline">
              {task.client_name || task.build_title}
            </Link>
          )}
        </div>
        {canManageBuilds && (
          <GenerateSopButton buildId={buildId} taskId={task.id} hasDescription={Boolean(task.description)} />
        )}
      </div>

      {task.description && (
        <div className="mt-2.5 rounded-md bg-slate-50 p-3 text-xs leading-relaxed whitespace-pre-wrap text-slate-700">
          {task.description}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 pt-2.5">
        {canManageBuilds && users.length > 0 ? (
          <form action={reassignTask} className="flex items-center gap-2">
            <input type="hidden" name="taskId" value={task.id} /><input type="hidden" name="buildId" value={buildId} />
            <span className="text-xs text-slate-400">Assignee</span>
            <Select name="assignee" defaultValue={task.assignee != null ? String(task.assignee) : ""} className="h-8 text-xs">
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
          <form action={updateTaskStatus} className="flex items-center gap-2">
            <input type="hidden" name="taskId" value={task.id} /><input type="hidden" name="buildId" value={buildId} />
            <span className="text-xs text-slate-400">Status</span>
            <Select name="status" defaultValue={task.status} className="h-8 text-xs">
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
            </Select>
            <Button type="submit" size="sm" variant="outline">Set</Button>
          </form>
        ) : (
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{TASK_STATUS_LABEL[task.status]}</span>
        )}

        {canManage && (
          <ConfirmDeleteButton
            action={deleteTask} fields={{ taskId: task.id, buildId }}
            title="Delete task" message={`Delete task "${task.title}"?`} label="Delete"
          />
        )}
      </div>
    </li>
  );
}
