"use client";
import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { useToast, Spinner } from "@/components/toast";
import { deleteBuild } from "./actions";

/**
 * Generic confirm-then-delete button. Pass a server action plus the form fields
 * it expects. Used for build sub-resources (tasks, gaps, change requests) that
 * each have their own delete action but share this confirm + toast UX.
 */
export function ConfirmDeleteButton({
  action, fields, title, message, label, confirmLabel = "Delete",
}: {
  action: (fd: FormData) => Promise<void>;
  fields: Record<string, string | number>;
  title: string;
  message: string;
  label?: string;
  confirmLabel?: string;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function requestDelete() {
    toast.confirm({
      title, message, confirmLabel, danger: true,
      onConfirm: () =>
        startTransition(async () => {
          try {
            const fd = new FormData();
            Object.entries(fields).forEach(([k, v]) => fd.set(k, String(v)));
            await action(fd);
          } catch (err) {
            if (err instanceof Error && err.message && !err.message.includes("NEXT_REDIRECT")) {
              toast.error(err.message, "Could not delete");
            }
          }
        }),
    });
  }

  if (label) {
    return (
      <button type="button" onClick={requestDelete} disabled={pending}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-200 bg-white px-2.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50">
        {pending ? <Spinner className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}{label}
      </button>
    );
  }
  return (
    <button type="button" onClick={requestDelete} disabled={pending} aria-label={title}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
      {pending ? <Spinner className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
    </button>
  );
}

export function BuildDeleteButton({ id, title, label }: { id: number; title: string; label?: string }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function requestDelete() {
    toast.confirm({
      title: "Delete build",
      message: `Delete "${title}"? This permanently removes the build and all its tasks, notes, and files.`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: () =>
        startTransition(async () => {
          try {
            const fd = new FormData();
            fd.set("id", String(id));
            await deleteBuild(fd);
            // deleteBuild revalidates + redirects to /builds, so the row disappears.
          } catch (err) {
            // A thrown redirect is expected control-flow; only surface real errors.
            if (err instanceof Error && err.message && !err.message.includes("NEXT_REDIRECT")) {
              toast.error(err.message, "Could not delete build");
            }
          }
        }),
    });
  }

  if (label) {
    return (
      <button
        type="button"
        onClick={requestDelete}
        disabled={pending}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 bg-white px-3 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? <Spinner /> : <Trash2 className="h-4 w-4" />}
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={requestDelete}
      disabled={pending}
      aria-label={`Delete ${title}`}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
    >
      {pending ? <Spinner /> : <Trash2 className="h-4 w-4" />}
    </button>
  );
}
