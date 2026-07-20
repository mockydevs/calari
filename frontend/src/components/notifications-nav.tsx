"use client";
import * as React from "react";
import { usePathname } from "next/navigation";
import { NavItem } from "./nav-item";
import { api } from "@/lib/portal/api";
import { useToast } from "./toast";
import { speak } from "@/lib/speech";

type NotificationItem = { id: number; message: string; link?: string };
type Paged = { count?: number; results?: NotificationItem[] };

// ── Singleton AudioContext ──────────────────────────────────────────────────
// Browsers suspend AudioContext until a user gesture. Create it once and reuse
// it so the unlock from the first click persists for every future chime.
let _audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (!_audioCtx) {
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) _audioCtx = new Ctor();
    } catch {
      /* not available */
    }
  }
  return _audioCtx;
}

function unlockAudio() {
  const ctx = getAudioCtx();
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
}

if (typeof document !== "undefined") {
  document.addEventListener("click", unlockAudio, { once: true, capture: true });
  document.addEventListener("keydown", unlockAudio, { once: true, capture: true });
  document.addEventListener("touchend", unlockAudio, { once: true, capture: true });
}

function playOn(ctx: AudioContext) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = "sine";
  // Two-tone chime: high → low
  osc.frequency.setValueAtTime(880, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
  gain.gain.setValueAtTime(0.35, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.5);
}

function playChime() {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      ctx.resume().then(() => playOn(ctx)).catch(() => {});
    } else {
      playOn(ctx);
    }
  } catch {
    /* AudioContext not available — ignore */
  }
}

function speakAlert(count: number) {
  speak(count > 1 ? `You have ${count} new notifications` : "You have a new notification");
}

/**
 * Notifications nav item with a live unread badge. Refetches on mount, on an interval,
 * when the tab regains focus, when the route changes, and when a `notifications:changed`
 * event fires (dispatched by the notifications page after marking things read) — so the
 * badge never goes stale after the user clears notifications.
 *
 * Also the always-on alert: when the unread count rises between polls, it plays a chime,
 * shows a toast, and speaks the new-notification count aloud — so staff notice an assigned
 * concern even with the tab in the background. The first fetch after mount only seeds the
 * baseline (no alert on login for pre-existing unread items).
 */
export function NotificationsNav() {
  const [unread, setUnread] = React.useState(0);
  const pathname = usePathname();
  const toast = useToast();
  const prevUnreadRef = React.useRef<number | null>(null);

  const refetch = React.useCallback(() => {
    api
      .get<NotificationItem[] | Paged>("builds/notifications?read=false")
      .then((d) => {
        const list = Array.isArray(d) ? d : d.results ?? [];
        const count = Array.isArray(d) ? d.length : d.count ?? list.length;
        setUnread(count);

        if (prevUnreadRef.current === null) {
          // First fetch after mount — seed the baseline, don't alert on pre-existing unread.
          prevUnreadRef.current = count;
          return;
        }
        if (count > prevUnreadRef.current) {
          const delta = count - prevUnreadRef.current;
          const latest = list[0]?.message;
          playChime();
          toast.info(latest && delta === 1 ? latest : `${delta} new notification${delta === 1 ? "" : "s"}`, "Notification");
          // Short delay so the chime finishes before the voice starts.
          setTimeout(() => speakAlert(delta), 550);
        }
        prevUnreadRef.current = count;
      })
      .catch(() => {});
  }, [toast]);

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
