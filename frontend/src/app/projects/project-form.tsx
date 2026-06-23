"use client";
import * as React from "react";
import { Pencil, Plus, X } from "lucide-react";
import { createProject, updateProject } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PRIORITIES, PRIORITY_LABELS, PROJECT_STATUSES, PROJECT_STATUS_LABELS, type Project,
} from "@/lib/portal/types";

export type Option = { id: number; name: string };

const selectCls =
  "h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-pink-500 focus:outline-none focus:ring-2 focus:ring-pink-500/30";

export function ProjectFormButton({
  clients,
  users,
  project,
}: {
  clients: Option[];
  users: Option[];
  project?: Project;
}) {
  const [open, setOpen] = React.useState(false);
  const isEdit = Boolean(project);

  return (
    <>
      {isEdit ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          <Pencil className="h-4 w-4" /> Edit
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-pink-700 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-pink-800"
        >
          <Plus className="h-4 w-4" /> New project
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm sm:items-center"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-pink-50 text-pink-700 ring-1 ring-pink-100">
                  <Plus className="h-4 w-4" />
                </span>
                {isEdit ? "Edit project" : "New project"}
              </h2>
              <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              action={isEdit ? updateProject : createProject}
              onSubmit={() => isEdit && setOpen(false)}
              className="space-y-4 p-5"
            >
              {isEdit && <input type="hidden" name="id" value={project!.id} />}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="name">Project name</Label>
                  <Input id="name" name="name" required defaultValue={project?.name} placeholder="e.g. Website redesign" />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="client">Client</Label>
                  <select id="client" name="client" required defaultValue={project?.client ?? ""} className={selectCls}>
                    <option value="" disabled>— Select client —</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="assigned_to">Primary assignee</Label>
                  <select id="assigned_to" name="assigned_to" defaultValue={project?.assigned_to ?? ""} className={selectCls}>
                    <option value="">— Unassigned —</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="status">Status</Label>
                  <select id="status" name="status" defaultValue={project?.status ?? "active"} className={selectCls}>
                    {PROJECT_STATUSES.map((s) => (
                      <option key={s} value={s}>{PROJECT_STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="priority">Priority</Label>
                  <select id="priority" name="priority" defaultValue={project?.priority ?? "medium"} className={selectCls}>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="start_date">Start date</Label>
                  <Input id="start_date" name="start_date" type="date" required defaultValue={project?.start_date} />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="end_date">End date</Label>
                  <Input id="end_date" name="end_date" type="date" required defaultValue={project?.end_date} />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="budget">Budget (optional)</Label>
                  <Input id="budget" name="budget" type="number" step="0.01" defaultValue={project?.budget ?? ""} placeholder="0.00" />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea id="description" name="description" rows={3} defaultValue={project?.description} placeholder="Briefly describe the project…" />
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-md px-4 text-sm font-medium text-slate-600 hover:bg-slate-100">
                  Cancel
                </button>
                <Button type="submit" className="h-9">{isEdit ? "Save changes" : "Create project"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
