"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, Bell, BriefcaseBusiness, CheckCheck, CheckCircle2, FileText,
  Mail, MessageSquare, RefreshCw, Trash2, X,
} from "lucide-react";
import { api, ApiError } from "@/lib/portal/api";
import { useToast, Spinner } from "@/components/toast";
import { Button } from "@/components/ui/button";

export type Notif = { id: number; type: string; message: string; link: string; read: boolean; created_at: string };
export type Prefs = {
  build_assigned: boolean;
  task_updated: boolean;
  follow_up_notes: boolean;
  change_requests: boolean;
  ready_for_review: boolean;
  document_uploaded: boolean;
  email_notifications: boolean;
};

// Notification type → icon + tint.
const TYPE_ICON: Record<string, { icon: React.ElementType; tint: string }> = {
  BUILD_ASSIGNED: { icon: BriefcaseBusiness, tint: "bg-pink-50 text-pink-700" },
  TASK_ASSIGNED: { icon: CheckCircle2, tint: "bg-pink-50 text-pink-700" },
  TASK_UPDATED: { icon: RefreshCw, tint: "bg-amber-50 text-amber-700" },
  MEETING_NOTE_ADDED: { icon: FileText, tint: "bg-slate-100 text-slate-600" },
  CHANGE_REQUEST: { icon: AlertTriangle, tint: "bg-violet-50 text-violet-700" },
  READY_FOR_REVIEW: { icon: CheckCircle2, tint: "bg-indigo-50 text-indigo-700" },
  CHANGES_REQUESTED: { icon: AlertTriangle, tint: "bg-orange-50 text-orange-700" },
  DOCUMENT_UPLOADED: { icon: FileText, tint: "bg-slate-100 text-slate-600" },
  SECTION_BLOCKED: { icon: AlertTriangle, tint: "bg-red-50 text-red-700" },
  SECTION_DONE: { icon: CheckCircle2, tint: "bg-emerald-50 text-emerald-700" },
  NEW_COMMENT: { icon: MessageSquare, tint: "bg-slate-100 text-slate-600" },
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.round((Date.now() - then) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

const PREF_FIELDS: [keyof Prefs, string][] = [
  ["build_assigned", "Build assigned"],
  ["task_updated", "Task updates"],
  ["follow_up_notes", "Follow-up notes"],
  ["change_requests", "Change requests"],
  ["ready_for_review", "Review status"],
  ["document_uploaded", "Document uploads"],
];

function notifyChanged() {
  window.dispatchEvent(new Event("notifications:changed"));
}

export function NotificationsClient({ initialItems, initialPrefs }: { initialItems: Notif[]; initialPrefs: Prefs }) {
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = React.useState<Notif[]>(initialItems);
  const [prefs, setPrefs] = React.useState<Prefs>(initialPrefs);
  const [filter, setFilter] = React.useState<"all" | "unread">("all");
  const [savingPrefs, setSavingPrefs] = React.useState(false);

  const unread = items.filter((n) => !n.read).length;
  const shown = filter === "unread" ? items.filter((n) => !n.read) : items;

  async function markRead(id: number) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    notifyChanged();
    try { await api.post(`builds/notifications/${id}/mark-read`, {}); } catch { /* optimistic */ }
  }

  async function markAllRead() {
    if (!unread) return;
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    notifyChanged();
    try { await api.post(`builds/notifications/mark-all-read`, {}); }
    catch (err) { toast.error(err instanceof ApiError ? err.message : "Could not mark all read."); }
  }

  function open(n: Notif) {
    if (!n.read) void markRead(n.id);
    if (n.link) router.push(n.link);
  }

  async function deleteOne(id: number) {
    setItems((prev) => prev.filter((n) => n.id !== id));
    notifyChanged();
    try { await api.del(`builds/notifications/${id}`); } catch { /* optimistic */ }
  }

  async function clearRead() {
    const readCount = items.filter((n) => n.read).length;
    if (!readCount) return;
    setItems((prev) => prev.filter((n) => !n.read));
    notifyChanged();
    try { await api.post(`builds/notifications/clear-read`, {}); }
    catch (err) { toast.error(err instanceof ApiError ? err.message : "Could not clear read notifications."); }
  }

  async function savePrefs() {
    setSavingPrefs(true);
    try {
      await api.patch("builds/notification-preferences", prefs);
      toast.success("Notification preferences saved.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save preferences.");
    } finally {
      setSavingPrefs(false);
    }
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* ── Inbox ─────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
            {(["all", "unread"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-md px-3 py-1.5 font-medium capitalize transition-colors ${filter === f ? "bg-pink-600 text-white" : "text-slate-600 hover:text-slate-900"}`}
              >
                {f}{f === "unread" && unread > 0 ? ` (${unread})` : ""}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={markAllRead} disabled={!unread}>
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </Button>
            <Button variant="outline" size="sm" onClick={clearRead} disabled={items.length === unread}>
              <Trash2 className="h-3.5 w-3.5" /> Clear read
            </Button>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]">
          {shown.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100"><Bell className="h-5 w-5 text-slate-400" /></div>
              <p className="mt-3 text-sm font-semibold text-slate-950">{filter === "unread" ? "No unread notifications" : "No notifications yet"}</p>
              <p className="mt-1 text-xs text-slate-500">You&apos;ll be notified when builds are assigned, reviewed, or updated.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {shown.map((n) => {
                const spec = TYPE_ICON[n.type] ?? { icon: Bell, tint: "bg-slate-100 text-slate-600" };
                const Icon = spec.icon;
                return (
                  <li key={n.id} className={`group flex items-stretch ${!n.read ? "bg-pink-50/30" : ""}`}>
                    <button
                      type="button"
                      onClick={() => open(n)}
                      className="flex flex-1 items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-pink-50/40"
                    >
                      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${spec.tint}`}><Icon className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm ${!n.read ? "font-semibold text-slate-950" : "text-slate-700"}`}>{n.message}</span>
                        <span className="mt-0.5 block text-xs text-slate-400">{relativeTime(n.created_at)}</span>
                      </span>
                      {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-pink-600" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteOne(n.id)}
                      aria-label="Delete notification"
                      className="flex w-10 shrink-0 items-center justify-center text-slate-300 transition-colors hover:bg-red-50 hover:text-red-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ── Preferences ──────────────────────────────────────── */}
      <aside className="space-y-4">
        <div className="rounded-lg border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/[0.03]">
          <h2 className="text-sm font-semibold text-slate-950">Email alerts</h2>
          <label className="mt-3 flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-3 text-sm">
            <input
              type="checkbox"
              checked={prefs.email_notifications}
              onChange={(e) => setPrefs((p) => ({ ...p, email_notifications: e.target.checked }))}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-pink-700"
            />
            <span>
              <span className="flex items-center gap-1.5 font-semibold text-slate-950"><Mail className="h-3.5 w-3.5" /> Email me notifications</span>
              <span className="mt-0.5 block text-xs text-slate-500">Send an email for the events enabled below. In-app notifications always appear here regardless.</span>
            </span>
          </label>

          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">Notify me about</h3>
          <div className="mt-2 space-y-2">
            {PREF_FIELDS.map(([name, label]) => (
              <label key={name} className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={prefs[name]}
                  onChange={(e) => setPrefs((p) => ({ ...p, [name]: e.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 text-pink-700"
                />
                {label}
              </label>
            ))}
          </div>
          <Button size="sm" className="mt-4 w-full" onClick={savePrefs} disabled={savingPrefs}>
            {savingPrefs ? <><Spinner className="h-3.5 w-3.5" /> Saving…</> : "Save preferences"}
          </Button>
        </div>
      </aside>
    </div>
  );
}
