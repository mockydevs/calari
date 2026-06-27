"use client";

import * as React from "react";
import {
  AlertTriangle, CalendarClock, CheckCircle2, FileText, GitBranch, Link2,
  Plug, RefreshCw, Tag, Upload, Workflow as WorkflowIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { updateBuildSectionReview } from "./actions";
import {
  ACTION_ITEM_CATEGORY_LABEL,
  type ActionItemCategory,
  type BuildDetail,
  type BuildSectionKey,
  type BuildSectionReview,
  type MeetingActionItem,
  type MeetingNote,
} from "./_shared";

const SECTIONS: { id: BuildSectionKey; label: string; icon: React.ReactNode }[] = [
  { id: "PIPELINE", label: "Pipeline", icon: <GitBranch className="h-4 w-4" /> },
  { id: "AUTOMATIONS", label: "Automations", icon: <WorkflowIcon className="h-4 w-4" /> },
  { id: "CLIENT_UPDATES", label: "New Features & Updates", icon: <RefreshCw className="h-4 w-4" /> },
  { id: "LEAD_SOURCES", label: "Lead Sources", icon: <Link2 className="h-4 w-4" /> },
  { id: "CALENDARS", label: "Calendars", icon: <CalendarClock className="h-4 w-4" /> },
  { id: "INTEGRATIONS", label: "Integrations", icon: <Plug className="h-4 w-4" /> },
  { id: "FIELDS_TAGS", label: "Fields & Tags", icon: <Tag className="h-4 w-4" /> },
  { id: "FORMS_PAYMENTS", label: "Forms & Payments", icon: <FileText className="h-4 w-4" /> },
  { id: "REPORTING_LAUNCH", label: "Reporting & Launch", icon: <CheckCircle2 className="h-4 w-4" /> },
];

const STATUS_STYLE: Record<string, string> = {
  TODO: "bg-slate-100 text-slate-600 ring-slate-200",
  DONE: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  BLOCKED: "bg-red-50 text-red-700 ring-red-200",
};
const CATEGORY_STYLE: Record<ActionItemCategory, string> = {
  REQUEST: "bg-pink-50 text-pink-700 ring-pink-200",
  CHANGE: "bg-violet-50 text-violet-700 ring-violet-200",
  QUESTION: "bg-amber-50 text-amber-700 ring-amber-200",
  DECISION: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  INFO: "bg-slate-50 text-slate-600 ring-slate-200",
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

function Empty() {
  return <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Nothing captured for this section yet. Check the meeting notes and raise a blocker if this is required before implementation.</p>;
}

function VerifyBadge({ item }: { item: MeetingActionItem }) {
  if (item.verification === "VERIFIED") {
    return <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200"><CheckCircle2 className="h-3 w-3" /> Verified</span>;
  }
  if (item.verification === "NEEDS_INFO") {
    return <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200"><AlertTriangle className="h-3 w-3" /> Needs info</span>;
  }
  return null;
}

function ItemRow({ item }: { item: MeetingActionItem }) {
  return (
    <li className="rounded-md border border-slate-200 p-3 text-sm">
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${CATEGORY_STYLE[item.category]}`}>
          {ACTION_ITEM_CATEGORY_LABEL[item.category]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className={`font-medium text-slate-900 ${item.status === "DONE" ? "text-slate-400 line-through" : ""}`}>{item.text}</p>
            <VerifyBadge item={item} />
          </div>
          {item.detail && <p className="mt-1 text-xs text-slate-600">{item.detail}</p>}
          {item.verification === "NEEDS_INFO" && item.verification_note && (
            <p className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
              <span className="font-semibold">AI: </span>{item.verification_note}
            </p>
          )}
          {item.verification === "VERIFIED" && item.evidence && (
            <p className="mt-1 text-[11px] text-emerald-700">✓ {item.evidence}</p>
          )}
          {item.introduced_in_title && <p className="mt-1 text-[11px] text-slate-400">from {item.introduced_in_title}</p>}
        </div>
      </div>
    </li>
  );
}

function SectionBody({
  section, build, items, notes,
}: { section: BuildSectionKey; build: BuildDetail; items: MeetingActionItem[]; notes: MeetingNote[] }) {
  const sectionItems = items.filter((i) => (i.section || "") === section);
  const changeRequests = build.change_requests ?? [];
  const updateNotes = notes.filter((n) => n.kind === "change_request" || n.kind === "progress");

  if (section === "CLIENT_UPDATES") {
    return (
      <div className="space-y-4 text-sm">
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
          Review every client-requested feature, mid-build scope update, and progress note here. Mark this section done only when approved updates have been built or explicitly deferred.
        </div>
        {sectionItems.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Captured requests</p>
            <ul className="mt-2 space-y-2">{sectionItems.map((i) => <ItemRow key={i.id} item={i} />)}</ul>
          </div>
        )}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Change requests / new features</p>
          {changeRequests.length === 0 ? (
            <p className="mt-2 rounded-md bg-slate-50 p-3 text-slate-500">No client updates or change requests captured yet.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {changeRequests.map((c) => (
                <li key={c.id} className="rounded-md border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-slate-900">{c.title}</p>
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{c.status}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">{c.description}</p>
                  {c.impact && <p className="mt-1 text-xs text-slate-500"><span className="font-semibold">Impact:</span> {c.impact}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Related progress/update notes</p>
          {updateNotes.length === 0 ? (
            <p className="mt-2 rounded-md bg-slate-50 p-3 text-slate-500">No progress or client-requested update notes logged.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {updateNotes.map((n) => (
                <li key={n.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="font-medium text-slate-800">{n.title || "Update note"}</p>
                  <p className="mt-1 line-clamp-5 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">{n.raw_text}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return sectionItems.length === 0 ? <Empty /> : (
    <ul className="space-y-2">{sectionItems.map((i) => <ItemRow key={i.id} item={i} />)}</ul>
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

export function ImplementationWorkspace({ build, buildId, notes }: { build: BuildDetail; buildId: string; notes: MeetingNote[] }) {
  const [active, setActive] = React.useState<BuildSectionKey>("AUTOMATIONS");
  const reviews = new Map((build.section_reviews ?? []).map((r) => [r.section, r]));
  const items = (build.action_items ?? []).filter((i) => !i.superseded);
  const countFor = (id: BuildSectionKey) => items.filter((i) => (i.section || "") === id).length;
  const activeSpec = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {SECTIONS.map((s) => {
          const on = s.id === active;
          const n = countFor(s.id);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              className={`-mb-px inline-flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm font-medium ${
                on ? "border-pink-600 text-pink-700" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {s.icon}{s.label}
              {n > 0 && <span className="rounded-full bg-slate-200 px-1.5 text-[10px] font-semibold text-slate-600">{n}</span>}
              <SectionStatus review={reviews.get(s.id)} />
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-950">{activeSpec.icon}{activeSpec.label}</div>
            <SectionBody section={active} build={build} items={items} notes={notes} />
          </section>
          <SectionControls buildId={buildId} section={active} review={reviews.get(active)} />
        </div>

        <aside className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-950">Original meeting notes</p>
          <p className="mt-1 text-xs text-slate-500">Use this to verify the tasklist against the raw client context.</p>
          <div className="mt-3 max-h-[520px] space-y-3 overflow-auto pr-1">
            {notes.length === 0 ? <p className="text-sm text-slate-500">No notes attached.</p> : notes.map((n) => (
              <details key={n.id} className="rounded-md border border-slate-200 bg-slate-50 p-2" open={notes.length === 1}>
                <summary className="cursor-pointer text-xs font-semibold text-slate-700">{n.title || "Meeting notes"}</summary>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">{n.raw_text}</p>
              </details>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
