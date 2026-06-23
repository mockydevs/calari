"use client";
import * as React from "react";
import { NavItem } from "./nav-item";
import { api } from "@/lib/portal/api";

type Paged = { count?: number; results?: unknown[] };

/** Notifications nav item that loads its unread badge client-side (non-blocking). */
export function NotificationsNav() {
  const [unread, setUnread] = React.useState(0);
  React.useEffect(() => {
    api
      .get<{ id: number }[] | Paged>("builds/notifications?read=false")
      .then((d) => setUnread(Array.isArray(d) ? d.length : d.count ?? d.results?.length ?? 0))
      .catch(() => {});
  }, []);
  return <NavItem href="/notifications" label="Notifications" iconName="Bell" badge={unread} />;
}
