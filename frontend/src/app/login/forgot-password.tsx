"use client";

import * as React from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, Mail } from "lucide-react";
import { api, ApiError } from "@/lib/portal/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Reset-password panel. Controlled by the parent (LoginForm): it replaces the
 * sign-in fields rather than rendering below them. `onCancel` returns to sign-in.
 */
export function ForgotPassword({ onCancel }: { onCancel: () => void }) {
  const [email, setEmail] = React.useState("");
  const [state, setState] = React.useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = React.useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setState("sending");
    try {
      const res = await api.post<{ message?: string }>("auth/forgot-password", { email: email.trim() });
      setMessage(res?.message ?? "If an account with that email exists, a temporary password has been sent to it.");
      setState("sent");
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-md bg-emerald-50 px-3.5 py-3 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{message}</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="flex w-full items-center justify-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-pink-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="reset-email">Reset password</Label>
        <p className="text-sm text-slate-500">
          We&apos;ll email you a temporary password to sign in with.
        </p>
        <Input
          id="reset-email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@calari.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-10"
        />
      </div>

      {state === "error" && (
        <div className="flex items-center gap-2 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {message}
        </div>
      )}

      <Button type="submit" disabled={state === "sending"} className="h-10 w-full">
        <Mail className="h-4 w-4" />
        {state === "sending" ? "Sending…" : "Send temporary password"}
      </Button>
      <button
        type="button"
        onClick={onCancel}
        className="flex w-full items-center justify-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-pink-700"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
      </button>
    </form>
  );
}
