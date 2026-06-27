"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Bot, Check, ChevronDown, Download, FileDown, Pencil, Plus, Printer, Trash2, X,
} from "lucide-react";
import { api, ApiError } from "@/lib/portal/api";
import { useToast, Spinner } from "@/components/toast";
import {
  ACTION_ITEM_CATEGORIES, ACTION_ITEM_CATEGORY_LABEL, ACTION_ITEM_SECTIONS,
  ACTION_ITEM_STATUSES, ACTION_ITEM_STATUS_LABEL,
  type ActionItemCategory, type ActionItemStatus, type BuildSectionKey,
  type MeetingActionItem, type MeetingNote,
} from "./_shared";

const STATUS_STYLE: Record<ActionItemStatus, string> = {
  OPEN: "bg-slate-100 text-slate-600",
  IN_PROGRESS: "bg-amber-100 text-amber-700",
  DONE: "bg-emerald-100 text-emerald-700",
  DROPPED: "bg-slate-100 text-slate-400 line-through",
};
const CATEGORY_STYLE: Record<ActionItemCategory, string> = {
  REQUEST: "bg-pink-50 text-pink-700 ring-pink-200",
  CHANGE: "bg-violet-50 text-violet-700 ring-violet-200",
  QUESTION: "bg-amber-50 text-amber-700 ring-amber-200",
  DECISION: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  INFO: "bg-slate-50 text-slate-600 ring-slate-200",
};

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "build";
}

export function MeetingTasklistPanel({
  buildId, title, items, notes, canManage, tasklistStatus,
}: {
  buildId: string;
  title: string;
  items: MeetingActionItem[];
  notes: MeetingNote[];
  canManage: boolean;
  tasklistStatus?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState(tasklistStatus === "processing");
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [adding, setAdding] = React.useState(false);

  const active = items.filter((i) => !i.superseded);
  const superseded = items.filter((i) => i.superseded);
  const hasList = items.length > 0;

  // ── Generate / re-sync from the latest meeting ──────────────────────────────
  async function generate() {
    setBusy(true);
    try {
      await api.post(`builds/builds/${buildId}/generate-tasklist`, {});
      toast.info(
        hasList
          ? "Re-syncing the tasklist against the latest meeting…"
          : "Reading every request from the meeting notes — this can take a moment.",
        "Working…",
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not start the tasklist.");
      setBusy(false);
      return;
    }
    const deadline = Date.now() + 120_000;
    const poll = async () => {
      const res = await api.get<{ tasklist_status?: string }>(`builds/builds/${buildId}`).catch(() => null);
      const status = res?.tasklist_status;
      if (status === "done") {
        toast.success("Tasklist updated.", "Done");
        setBusy(false);
        router.refresh();
        return;
      }
      if (status === "failed") {
        toast.error("Tasklist generation failed — check Settings → AI Keys and try again.", "Failed");
        setBusy(false);
        return;
      }
      if (Date.now() > deadline) {
        toast.info("Still working in the background — refresh in a moment.");
        setBusy(false);
        router.refresh();
        return;
      }
      setTimeout(poll, 2500);
    };
    setTimeout(poll, 2500);
  }

  // ── Per-item mutations ──────────────────────────────────────────────────────
  async function setStatus(item: MeetingActionItem, status: ActionItemStatus) {
    try {
      await api.post(`builds/action-items/${item.id}/status`, { status });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update status.");
    }
  }

  async function remove(item: MeetingActionItem) {
    if (!confirm(`Delete this item?\n\n${item.text}`)) return;
    try {
      await api.del(`builds/action-items/${item.id}`);
      toast.success("Item deleted.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete item.");
    }
  }

  // ── Downloads ───────────────────────────────────────────────────────────────
  async function download(format: "md" | "csv") {
    try {
      const res = await api.get<{ filename: string; content: string }>(
        `builds/builds/${buildId}/tasklist-export`, { format },
      );
      const blob = new Blob([res.content], { type: format === "csv" ? "text/csv" : "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename || `${slugify(title)}-tasklist.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not export the tasklist.");
    }
  }

  function printPdf() {
    const win = window.open("", "_blank", "width=840,height=1000");
    if (!win) {
      toast.error("Allow pop-ups to print / save as PDF.");
      return;
    }
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
    const groups = ACTION_ITEM_SECTIONS
      .map((sec) => ({ label: sec.label, rows: active.filter((i) => (i.section || "") === sec.key) }))
      .filter((g) => g.rows.length);
    const body = groups.map((g) => `
      <h2>${esc(g.label)}</h2>
      <ul>${g.rows.map((i) => `<li><strong>[${ACTION_ITEM_CATEGORY_LABEL[i.category]}]</strong> ${esc(i.text)}${i.detail ? ` <em>— ${esc(i.detail)}</em>` : ""}${i.status !== "OPEN" ? ` <span class="st">(${ACTION_ITEM_STATUS_LABEL[i.status]})</span>` : ""}</li>`).join("")}</ul>
    `).join("");
    win.document.write(`<!doctype html><html><head><title>${esc(title)} — Tasklist</title>
      <style>body{font:14px/1.5 system-ui,sans-serif;max-width:760px;margin:32px auto;padding:0 16px;color:#1e293b}
      h1{font-size:22px} h2{font-size:15px;margin-top:24px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
      ul{padding-left:20px} li{margin:6px 0} .st{color:#b45309} em{color:#64748b}</style></head>
      <body><h1>${esc(title)} — Build Tasklist</h1><p>${active.length} item(s) captured from meeting notes.</p>
      ${body || "<p>No items captured yet.</p>"}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 250);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* ── Main: the reconciled tasklist ─────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">
            {active.length} item{active.length === 1 ? "" : "s"} captured straight from the meeting notes
            {superseded.length > 0 && ` · ${superseded.length} superseded`}.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {hasList && (
              <>
                <button type="button" onClick={() => download("md")} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  <FileDown className="h-3.5 w-3.5" /> .md
                </button>
                <button type="button" onClick={() => download("csv")} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  <Download className="h-3.5 w-3.5" /> .csv
                </button>
                <button type="button" onClick={printPdf} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  <Printer className="h-3.5 w-3.5" /> PDF
                </button>
              </>
            )}
            {canManage && (
              <button type="button" onClick={generate} disabled={busy}
                className="inline-flex h-8 items-center gap-2 rounded-md bg-gradient-to-r from-pink-600 to-fuchsia-600 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:from-pink-700 hover:to-fuchsia-700 disabled:opacity-60">
                {busy ? <><Spinner className="h-3.5 w-3.5" /> Working…</> : <><Bot className="h-3.5 w-3.5" /> {hasList ? "Re-sync from latest meeting" : "Generate from notes"}</>}
              </button>
            )}
          </div>
        </div>

        {!hasList ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-8 text-center">
            <p className="text-sm font-medium text-slate-700">No tasklist yet.</p>
            <p className="mt-1 text-xs text-slate-500">
              {canManage
                ? "Generate a source-faithful checklist of every request, change, and question from the meeting notes — organized by GHL section."
                : "A manager can generate the tasklist from the meeting notes."}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {ACTION_ITEM_SECTIONS.map((sec) => {
              const rows = active.filter((i) => (i.section || "") === sec.key);
              if (!rows.length) return null;
              return (
                <section key={sec.key || "other"} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">{sec.label}</h3>
                    <span className="text-[11px] text-slate-400">{rows.length}</span>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {rows.map((item) => (
                      <li key={item.id} className="px-4 py-3">
                        {editingId === item.id ? (
                          <ItemEditor item={item} buildId={buildId} onDone={() => { setEditingId(null); router.refresh(); }} onCancel={() => setEditingId(null)} />
                        ) : (
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${CATEGORY_STYLE[item.category]}`}>
                                  {ACTION_ITEM_CATEGORY_LABEL[item.category]}
                                </span>
                                {item.verification === "VERIFIED" && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">Verified</span>}
                                {item.verification === "NEEDS_INFO" && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">Needs info</span>}
                                {item.locked && <span className="text-[10px] text-slate-400" title="Edited by a human — protected from AI re-sync">edited</span>}
                              </div>
                              <p className={`text-sm text-slate-900 ${item.status === "DONE" ? "line-through text-slate-400" : ""}`}>{item.text}</p>
                              {item.detail && <p className="text-xs text-slate-500">{item.detail}</p>}
                              {item.verification === "NEEDS_INFO" && item.verification_note && (
                                <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900"><span className="font-semibold">AI: </span>{item.verification_note}</p>
                              )}
                              <p className="text-[11px] text-slate-400">
                                {item.introduced_in_title && <>from {item.introduced_in_title}</>}
                                {item.last_changed_in_title && item.last_changed_in_title !== item.introduced_in_title && <> · changed in {item.last_changed_in_title}</>}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              {canManage ? (
                                <div className="relative">
                                  <select
                                    value={item.status}
                                    onChange={(e) => setStatus(item, e.target.value as ActionItemStatus)}
                                    className={`h-7 appearance-none rounded-md pl-2 pr-6 text-xs font-semibold ${STATUS_STYLE[item.status]}`}
                                  >
                                    {ACTION_ITEM_STATUSES.map((s) => <option key={s} value={s}>{ACTION_ITEM_STATUS_LABEL[s]}</option>)}
                                  </select>
                                  <ChevronDown className="pointer-events-none absolute right-1.5 top-1.5 h-3.5 w-3.5 text-current opacity-60" />
                                </div>
                              ) : (
                                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[item.status]}`}>{ACTION_ITEM_STATUS_LABEL[item.status]}</span>
                              )}
                              {canManage && (
                                <>
                                  <button type="button" onClick={() => setEditingId(item.id)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                                  <button type="button" onClick={() => remove(item)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}

            {superseded.length > 0 && (
              <details className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-slate-500">Superseded — no longer in scope ({superseded.length})</summary>
                <ul className="mt-2 space-y-1.5">
                  {superseded.map((item) => (
                    <li key={item.id} className="flex items-start justify-between gap-2 text-xs text-slate-500">
                      <span><span className="line-through">{item.text}</span>{item.superseded_reason && ` — ${item.superseded_reason}`}</span>
                      {canManage && <button type="button" onClick={() => remove(item)} className="shrink-0 text-slate-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {/* Manual add */}
        {canManage && hasList && (
          adding ? (
            <ItemEditor buildId={buildId} onDone={() => { setAdding(false); router.refresh(); }} onCancel={() => setAdding(false)} />
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-pink-700 hover:text-pink-800">
              <Plus className="h-3.5 w-3.5" /> Add item manually
            </button>
          )
        )}
      </div>

      {/* ── Side panel: original meeting notes, to verify against ──────── */}
      <aside className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-950">Original meeting notes</p>
        <p className="mt-1 text-xs text-slate-500">The exact notes this tasklist was captured from — verify nothing was missed.</p>
        <div className="mt-3 max-h-[560px] space-y-2 overflow-auto pr-1">
          {notes.length === 0 ? (
            <p className="text-xs text-slate-400">No meeting notes yet.</p>
          ) : (
            notes.map((n) => (
              <details key={n.id} className="rounded-md border border-slate-200 bg-slate-50 p-2" open={notes.length === 1}>
                <summary className="cursor-pointer text-xs font-semibold text-slate-700">{n.title || "Meeting notes"}</summary>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">{n.raw_text}</p>
              </details>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}

/** Inline create/edit form for a tasklist item. */
function ItemEditor({
  item, buildId, onDone, onCancel,
}: {
  item?: MeetingActionItem;
  buildId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [text, setText] = React.useState(item?.text ?? "");
  const [detail, setDetail] = React.useState(item?.detail ?? "");
  const [category, setCategory] = React.useState<ActionItemCategory>(item?.category ?? "REQUEST");
  const [section, setSection] = React.useState<BuildSectionKey | "">(item?.section ?? "");
  const [supersede, setSupersede] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  async function save() {
    if (!text.trim()) return;
    setSaving(true);
    try {
      const payload = {
        text: text.trim(), detail: detail.trim(), category, section,
        ...(item ? { superseded: supersede } : { build: Number(buildId) }),
      };
      if (item) await api.patch(`builds/action-items/${item.id}`, payload);
      else await api.post(`builds/action-items`, payload);
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the item.");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-pink-200 bg-pink-50/40 p-3">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="What did the client ask for? (their words)"
        className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500" />
      <input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Detail / context (optional)"
        className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500" />
      <div className="flex flex-wrap items-center gap-2">
        <select value={category} onChange={(e) => setCategory(e.target.value as ActionItemCategory)} className="h-8 rounded-md border border-slate-300 px-2 text-xs">
          {ACTION_ITEM_CATEGORIES.map((c) => <option key={c} value={c}>{ACTION_ITEM_CATEGORY_LABEL[c]}</option>)}
        </select>
        <select value={section} onChange={(e) => setSection(e.target.value as BuildSectionKey | "")} className="h-8 rounded-md border border-slate-300 px-2 text-xs">
          {ACTION_ITEM_SECTIONS.map((s) => <option key={s.key || "other"} value={s.key}>{s.label}</option>)}
        </select>
        {item && (
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={supersede} onChange={(e) => setSupersede(e.target.checked)} /> Supersede
          </label>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={onCancel} className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50"><X className="h-3.5 w-3.5" /> Cancel</button>
          <button type="button" onClick={save} disabled={saving || !text.trim()} className="inline-flex h-8 items-center gap-1 rounded-md bg-pink-600 px-3 text-xs font-semibold text-white hover:bg-pink-700 disabled:opacity-60">
            {saving ? <Spinner className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}
