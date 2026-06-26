"use client";

import * as React from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast, Spinner } from "@/components/toast";
import { assignBuild, approveBuild } from "./actions";

type Member = { id: number; name: string };

/**
 * One control for both assigning a build and approving the build-out. Validates
 * member selection client-side and surfaces any backend error as a toast, so a
 * missing-member click never falls through to the route error boundary.
 */
export function AssignApprove({
  buildId,
  members,
  defaultAssigneeId,
  canApprove,
}: {
  buildId: string;
  members: Member[];
  defaultAssigneeId: string;
  canApprove: boolean;
}) {
  const toast = useToast();
  const [assignee, setAssignee] = React.useState(defaultAssigneeId);
  const [pending, start] = React.useTransition();
  const [mode, setMode] = React.useState<"assign" | "approve" | null>(null);

  function run(kind: "assign" | "approve") {
    if (!assignee) {
      toast.error(
        kind === "approve" ? "Select a team member before approving." : "Select a team member to assign.",
      );
      return;
    }
    setMode(kind);
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("id", buildId);
        fd.set("assigneeId", assignee);
        if (kind === "assign") await assignBuild(fd);
        else await approveBuild(fd);
        toast.success(
          kind === "approve" ? "Build-out approved and handed to staff." : "Build assigned.",
        );
      } catch (e) {
        if (e instanceof Error && !e.message.includes("NEXT_REDIRECT")) {
          toast.error(e.message, kind === "approve" ? "Could not approve" : "Could not assign");
        }
      } finally {
        setMode(null);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <Label htmlFor="assigneeId" className="text-xs">Assign / approve to</Label>
        <Select
          id="assigneeId"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          className="h-9"
        >
          <option value="">Select member</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
      </div>
      <Button type="button" onClick={() => run("assign")} disabled={pending} size="sm" variant="outline">
        {pending && mode === "assign" && <Spinner className="h-3.5 w-3.5" />} Assign
      </Button>
      {canApprove && (
        <Button type="button" onClick={() => run("approve")} disabled={pending} size="sm" variant="success">
          {pending && mode === "approve" ? <Spinner className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          Approve &amp; hand to staff
        </Button>
      )}
    </div>
  );
}
