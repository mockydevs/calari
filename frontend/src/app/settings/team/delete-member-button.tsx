"use client";

import { useRef, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast";
import { deleteUser } from "./actions";

export function DeleteMemberButton({ id, name }: { id: number; name: string }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const deleting = useRef(false);

  function confirmDelete() {
    toast.confirm({
      title: `Delete ${name}?`,
      message: "This removes the staff member from the team and disables sign-in. Existing tasks, projects and history are kept. Reassign any outstanding work. This cannot be undone from the Team page.",
      confirmLabel: "Delete staff member",
      danger: true,
      onConfirm: () => {
        if (deleting.current) return;
        deleting.current = true;
        startTransition(async () => {
          try {
            await deleteUser(id);
            toast.success(`${name} has been removed from the team.`);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Please try again.", "Could not delete staff member");
          } finally {
            deleting.current = false;
          }
        });
      },
    });
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="border-red-200 text-red-700 hover:border-red-300 hover:bg-red-50"
      aria-label={`Delete ${name}`}
      disabled={pending}
      onClick={confirmDelete}
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      {pending ? "Deleting…" : "Delete"}
    </Button>
  );
}
