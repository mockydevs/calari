import { requireUser } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import { NotificationsClient, type Notif, type Prefs } from "./notifications-client";

export const dynamic = "force-dynamic";

const DEFAULT_PREFS: Prefs = {
  build_assigned: true,
  task_updated: true,
  follow_up_notes: true,
  change_requests: true,
  ready_for_review: true,
  document_uploaded: true,
  email_notifications: true,
};

function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

export default async function NotificationsPage() {
  await requireUser();
  const [items, preferences] = await Promise.all([
    serverApi.get<Notif[] | { results: Notif[] }>("builds/notifications").then(asList).catch(() => [] as Notif[]),
    serverApi.get<Prefs>("builds/notification-preferences").catch(() => DEFAULT_PREFS),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">Inbox</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Notifications</h1>
        <p className="mt-1 text-sm text-slate-600">Build assignments, reviews, updates, and comments — and how you&apos;re alerted.</p>
      </div>
      <NotificationsClient initialItems={items} initialPrefs={{ ...DEFAULT_PREFS, ...preferences }} />
    </div>
  );
}
