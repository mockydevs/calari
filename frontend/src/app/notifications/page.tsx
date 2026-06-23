import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import { markAllRead, updateNotificationPreferences } from "./actions";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Notif = { id: number; message: string; link: string; read: boolean; created_at: string };
type Prefs = {
  build_assigned: boolean;
  task_updated: boolean;
  follow_up_notes: boolean;
  change_requests: boolean;
  ready_for_review: boolean;
  document_uploaded: boolean;
};

const DEFAULT_PREFS: Prefs = {
  build_assigned: true,
  task_updated: true,
  follow_up_notes: true,
  change_requests: true,
  ready_for_review: true,
  document_uploaded: true,
};

function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

export default async function NotificationsPage() {
  await requireUser();
  const items = await serverApi
    .get<Notif[] | { results: Notif[] }>("builds/notifications")
    .then(asList)
    .catch(() => [] as Notif[]);
  const preferences = await serverApi
    .get<Prefs>("builds/notification-preferences")
    .catch(() => DEFAULT_PREFS);

  const unreadCount = items.filter((n) => !n.read).length;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Inbox</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Notifications</h1>
          <p className="mt-1 text-sm text-slate-600">
            {unreadCount > 0
              ? `${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}`
              : "You are all caught up."}
          </p>
        </div>
        {unreadCount > 0 && (
          <form action={markAllRead}>
            <Button variant="outline" size="sm">
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </Button>
          </form>
        )}
      </div>

      <form action={updateNotificationPreferences} className="rounded-lg border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/[0.03]">
        <h2 className="text-sm font-semibold text-slate-950">Notification preferences</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {([
            ["build_assigned", "Build assigned"],
            ["task_updated", "Task updates"],
            ["follow_up_notes", "Follow-up notes"],
            ["change_requests", "Change requests"],
            ["ready_for_review", "Review status"],
            ["document_uploaded", "Document uploads"],
          ] as const).map(([name, label]) => (
            <label key={name} className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                name={name}
                defaultChecked={preferences[name]}
                className="h-4 w-4 rounded border-slate-300 text-cyan-700"
              />
              {label}
            </label>
          ))}
        </div>
        <Button size="sm" className="mt-4">Save preferences</Button>
      </form>

      <div className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100">
              <Bell className="h-5 w-5 text-slate-400" />
            </div>
            <p className="mt-3 text-sm font-semibold text-slate-950">No notifications yet</p>
            <p className="mt-1 text-xs text-slate-500">
              You will be notified when builds are assigned, reviewed, or updated.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((n) => (
              <li
                key={n.id}
                className={`flex items-start justify-between gap-4 px-5 py-4 transition-colors hover:bg-cyan-50/30 ${!n.read ? "bg-cyan-50/40" : ""}`}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${!n.read ? "bg-cyan-600" : "bg-transparent"}`} />
                  <Link href={n.link || "#"} className="text-sm font-medium text-slate-800 transition-colors hover:text-cyan-700">
                    {n.message}
                  </Link>
                </div>
                <span className="shrink-0 text-xs text-slate-400">{formatDate(n.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
