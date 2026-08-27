"use client";

import * as React from "react";
import {
  AlertTriangle, CheckCircle2, Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { updateBuildSectionReview } from "./actions";
import {
  type BuildSectionKey,
  type BuildSectionReview,
} from "./_shared";

const STATUS_STYLE: Record<string, string> = {
  TODO: "bg-slate-100 text-slate-600 ring-slate-200",
  DONE: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  BLOCKED: "bg-red-50 text-red-700 ring-red-200",
};

function SectionStatus({ review }: { review?: BuildSectionReview }) {
  const status = review?.status ?? "TODO";
  const label = status === "DONE" ? "Done" : status === "BLOCKED" ? "Blocked" : "To do";
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${STATUS_STYLE[status]}`}>
      {label}
    </span>
  );
}

export function SectionControls({ buildId, section, review }: { buildId: string; section: BuildSectionKey; review?: BuildSectionReview }) {
  const [showBlocker, setShowBlocker] = React.useState(review?.status === "BLOCKED");
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <SectionStatus review={review} />
          {review?.status === "DONE" && <span className="text-xs text-slate-500">Completed by {review.completed_by_name || "staff"}</span>}
          {review?.status === "BLOCKED" && <span className="text-xs text-red-600">Blocked by {review.blocked_by_name || "staff"}</span>}
        </div>
        <div className="flex items-center gap-2">
          <form action={updateBuildSectionReview}>
            <input type="hidden" name="buildId" value={buildId} />
            <input type="hidden" name="section" value={section} />
            <input type="hidden" name="status" value="DONE" />
            <Button type="submit" size="sm" className="bg-emerald-600 hover:bg-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> All done</Button>
          </form>
          <Button type="button" size="sm" variant="outline" onClick={() => setShowBlocker((v) => !v)}>
            <AlertTriangle className="h-3.5 w-3.5" /> Blocker
          </Button>
        </div>
      </div>
      {review?.status === "BLOCKED" && review.blocker_note && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">Current blocker</p>
          <p className="mt-1 whitespace-pre-wrap">{review.blocker_note}</p>
          {review.blocker_attachment_url && (
            <a href={review.blocker_attachment_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-semibold text-red-700 underline">
              {review.blocker_attachment_name || "View attachment"}
            </a>
          )}
        </div>
      )}
      {showBlocker && (
        <form action={updateBuildSectionReview} className="mt-3 space-y-2">
          <input type="hidden" name="buildId" value={buildId} />
          <input type="hidden" name="section" value={section} />
          <input type="hidden" name="status" value="BLOCKED" />
          <Textarea name="blockerNote" required rows={3} placeholder="Explain what is blocking this section, what is missing, and what admin/client decision is needed." />
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-500">
            <Upload className="h-3.5 w-3.5" />
            <span>Optional blocker file or screenshot</span>
            <input type="file" name="blockerFile" className="ml-auto text-xs" />
          </label>
          <Button type="submit" size="sm" variant="outline" className="border-red-200 text-red-700 hover:bg-red-50">Submit blocker</Button>
        </form>
      )}
    </div>
  );
}
