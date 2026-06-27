"use client";
import * as React from "react";
import { usePathname } from "next/navigation";
import { NavItem } from "./nav-item";
import { api } from "@/lib/portal/api";

type Paged = { count?: number; results?: unknown[] };

/**
 * Notifications nav item with a live unread badge. Refetches on mount, on an interval,
 * when the tab regains focus, when the route changes, and when a `notifications:changed`
 * event fires (dispatched by the notifications page after marking things read) — so the
 * badge never goes stale after the user clears notifications.
 */
export function NotificationsNav() {
  const [unread, setUnread] = React.useState(0);
  const pathname = usePathname();

  const refetch = React.useCallback(() => {
    api
      .get<{ id: number }[] | Paged>("builds/notifications?read=false")
      .then((d) => setUnread(Array.isArray(d) ? d.length : d.count ?? d.results?.length ?? 0))
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    refetch();
    const interval = setInterval(refetch, 45_000);
    const onVisible = () => document.visibilityState === "visible" && refetch();
    window.addEventListener("focus", refetch);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("notifications:changed", refetch);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refetch);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("notifications:changed", refetch);
    };
  }, [refetch]);

  // Re-check when navigating (e.g. leaving /notifications after reading them).
  React.useEffect(() => { refetch(); }, [pathname, refetch]);

  return <NavItem href="/notifications" label="Notifications" iconName="Bell" badge={unread} />;
}
