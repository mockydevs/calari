"use client";
import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { useToast, Spinner } from "@/components/toast";
import { deleteProject } from "./actions";

export function ProjectDeleteButton({ id, name }: { id: number; name: string }) {
  const toast = useToast();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        toast.confirm({
          title: "Delete project",
          danger: true,
          confirmLabel: "Delete",
          message: `Delete "${name}"? This permanently removes the project and all its tasks, milestones, blockers, and files.`,
          onConfirm: () =>
            start(async () => {
              try {
                const fd = new FormData();
                fd.set("id", String(id));
                await deleteProject(fd);
              } catch (err) {
                if (err instanceof Error && !err.message.includes("NEXT_REDIRECT")) {
                  toast.error(err.message, "Could not delete project");
                }
              }
            }),
        })
      }
      className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 bg-white px-3 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
    >
      {pending ? <Spinner /> : <Trash2 className="h-4 w-4" />} Delete
    </button>
  );
}
