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
  WORKFLOW_CATEGORY_LABEL,
  type BuildDetail,
  type BuildSectionKey,
  type BuildSectionReview,
  type MeetingNote,
  type Workflow,
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

function SectionStatus({ review }: { review?: BuildSectionReview }) {
  const status = review?.status ?? "TODO";
  const label = status === "DONE" ? "Done" : status === "BLOCKED" ? "Blocked" : "To do";
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${STATUS_STYLE[status]}`}>
      {label}
    </span>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">No {label} captured yet. Check the meeting notes and raise a blocker if this is required before implementation.</p>;
}

function WorkflowList({ workflows }: { workflows: Workflow[] }) {
  if (workflows.length === 0) return <Empty label="automations" />;
  const grouped = workflows.reduce<Record<string, Workflow[]>>((acc, w) => {
    (acc[w.category] ??= []).push(w);
    return acc;
  }, {});
  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([category, group]) => (
        <div key={category}>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{WORKFLOW_CATEGORY_LABEL[category] ?? category}</p>
          <ul className="mt-2 space-y-2">
            {group.map((w) => (
              <li key={w.id} className="rounded-md border border-slate-200 p-3 text-sm">
                <p className="font-medium text-slate-900">{[w.code, w.name].filter(Boolean).join(" - ")}</p>
                {w.trigger && <p className="mt-1 text-xs text-slate-500"><span className="font-semibold">Trigger:</span> {w.trigger}</p>}
                {w.what_it_does && <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">{w.what_it_does}</p>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function SectionBody({ section, build, notes }: { section: BuildSectionKey; build: BuildDetail; notes: MeetingNote[] }) {
  const stages = build.stages ?? [];
  const transitions = build.transitions ?? [];
  const workflows = build.workflows ?? [];
  const sources = build.contact_sources ?? [];
  const calendars = build.calendars ?? [];
  const integrations = build.external_integrations ?? [];
  const fields = build.custom_fields ?? [];
  const tags = build.tags ?? [];
  const tasks = build.tasks ?? [];
  const preLaunch = build.pre_launch_items ?? [];
  const changeRequests = build.change_requests ?? [];
  const updateNotes = notes.filter((n) => n.kind === "change_request" || n.kind === "progress");
  const stageName = new Map(stages.map((s) => [s.id, s.name]));

  if (section === "PIPELINE") {
    return stages.length === 0 ? <Empty label="pipeline stages" /> : (
      <div className="space-y-4">
        <ol className="space-y-2">
          {stages.map((s) => (
            <li key={s.id} className="rounded-md border border-slate-200 p-3 text-sm">
              <p className="font-medium text-slate-900">{s.order}. {s.name}</p>
              {s.description && <p className="mt-1 text-xs text-slate-600">{s.description}</p>}
              {s.entry_condition && <p className="mt-1 text-xs text-slate-500"><span className="font-semibold">Entry:</span> {s.entry_condition}</p>}
            </li>
          ))}
        </ol>
        {transitions.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stage movement</p>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
              {transitions.map((t) => (
                <li key={t.id} className="rounded-md bg-slate-50 px-3 py-2">
                  {(t.from_stage ? stageName.get(t.from_stage) : t.from_label) || "Start"} → {(t.to_stage ? stageName.get(t.to_stage) : t.to_label) || "Next"}: {t.trigger}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (section === "AUTOMATIONS") return <WorkflowList workflows={workflows} />;

  if (section === "CLIENT_UPDATES") {
    return (
      <div className="space-y-4 text-sm">
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
          Review every client-requested feature, mid-build scope update, and progress note here. Mark this section done only when approved updates have been built or explicitly deferred.
        </div>
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

  if (section === "LEAD_SOURCES") {
    return sources.length === 0 ? <Empty label="lead sources" /> : (
      <ul className="space-y-2">
        {sources.map((s) => (
          <li key={s.id} className="rounded-md border border-slate-200 p-3 text-sm">
            <p className="font-medium text-slate-900">{s.label}</p>
            <p className="mt-1 text-xs text-slate-600">Enters via: {s.entry_mechanism || "Not specified"}</p>
            <p className="mt-1 text-xs text-slate-500">Tags: {s.tags_applied || "None specified"} · Workflow: {s.handling_workflow || "Not specified"}</p>
          </li>
        ))}
      </ul>
    );
  }

  if (section === "CALENDARS") {
    return calendars.length === 0 ? <Empty label="calendars" /> : (
      <ul className="space-y-2">
        {calendars.map((c) => (
          <li key={c.id} className="rounded-md border border-slate-200 p-3 text-sm">
            <p className="font-medium text-slate-900">{c.name}</p>
            {c.purpose && <p className="mt-1 text-xs text-slate-600">{c.purpose}</p>}
            <p className="mt-1 text-xs text-slate-500">Books into: {c.books_into_stage ? stageName.get(c.books_into_stage) : "Not specified"}</p>
            {c.reminders && <p className="mt-1 text-xs text-slate-500">Reminders: {c.reminders}</p>}
          </li>
        ))}
      </ul>
    );
  }

  if (section === "INTEGRATIONS") {
    return integrations.length === 0 ? <Empty label="integrations" /> : (
      <ul className="space-y-2">
        {integrations.map((i) => (
          <li key={i.id} className="rounded-md border border-slate-200 p-3 text-sm">
            <p className="font-medium text-slate-900">{i.name}</p>
            <p className="mt-1 text-xs text-slate-600">{i.direction} · {i.mechanism} · {i.data_objects || "Data objects not specified"}</p>
            {i.purpose && <p className="mt-1 text-xs text-slate-500">{i.purpose}</p>}
          </li>
        ))}
      </ul>
    );
  }

  if (section === "FIELDS_TAGS") {
    return fields.length === 0 && tags.length === 0 ? <Empty label="fields or tags" /> : (
      <div className="space-y-4 text-sm">
        {fields.length > 0 && <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Custom fields & values</p><div className="mt-2 flex flex-wrap gap-1.5">{fields.map((f) => <span key={f.id} className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700">{f.key}</span>)}</div></div>}
        {tags.length > 0 && <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tags</p><div className="mt-2 flex flex-wrap gap-1.5">{tags.map((t) => <span key={t.id} className="rounded-md bg-pink-50 px-2 py-1 font-mono text-xs text-pink-700">{t.tag}</span>)}</div></div>}
      </div>
    );
  }

  if (section === "FORMS_PAYMENTS") {
    const relevant = tasks.filter((t) => ["FORM", "INTEGRATION"].includes(t.type));
    return (
      <div className="space-y-3 text-sm">
        <p className="rounded-md bg-slate-50 p-3 text-slate-600">
          Verify every reporting form, payment link, source-of-truth handoff, and milestone update described in the notes. If the AI did not capture a required form/payment flow, raise a blocker with the missing fields.
        </p>
        {relevant.length > 0 && (
          <ul className="space-y-2">{relevant.map((t) => (
            <li key={t.id} className="rounded-md border border-slate-200 p-3">
              <p className="font-medium text-slate-900">{t.title}</p>
              {t.description && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{t.description}</p>}
            </li>
          ))}</ul>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      {build.goals && <p className="rounded-md bg-slate-50 p-3 text-slate-600">{build.goals}</p>}
      {preLaunch.length === 0 ? <Empty label="launch checklist items" /> : (
        <ul className="space-y-2">{preLaunch.map((p) => (
          <li key={p.id} className="rounded-md border border-slate-200 p-3 text-slate-700">{p.description}</li>
        ))}</ul>
      )}
    </div>
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
  const activeSpec = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {SECTIONS.map((s) => {
          const on = s.id === active;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              className={`-mb-px inline-flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm font-medium ${
                on ? "border-pink-600 text-pink-700" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {s.icon}{s.label}<SectionStatus review={reviews.get(s.id)} />
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-950">{activeSpec.icon}{activeSpec.label}</div>
            <SectionBody section={active} build={build} notes={notes} />
          </section>
          <SectionControls buildId={buildId} section={active} review={reviews.get(active)} />
        </div>

        <aside className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-950">Original meeting notes</p>
          <p className="mt-1 text-xs text-slate-500">Use this to verify the AI procedure against the raw client context.</p>
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
