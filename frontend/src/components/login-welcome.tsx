"use client";
import * as React from "react";
import { speak } from "@/lib/speech";

const SESSION_KEY = "calari_welcomed";

/**
 * Speaks a one-time "Welcome back, {name}" greeting the first time the
 * authenticated shell mounts in a browser tab — not on every page navigation
 * within the same session (sessionStorage guards the repeat; a fresh login
 * or a new tab gets the greeting again).
 */
export function LoginWelcome({ name }: { name: string }) {
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem(SESSION_KEY)) return;
    window.sessionStorage.setItem(SESSION_KEY, "1");
    const firstName = name.split(" ")[0] || name;
    speak(`Welcome back, ${firstName}`);
  }, [name]);

  return null;
}
