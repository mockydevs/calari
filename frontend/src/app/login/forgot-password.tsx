"use client";

import * as React from "react";
import { AlertCircle, CheckCircle2, Mail } from "lucide-react";
import { api, ApiError } from "@/lib/portal/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPassword() {
  const [open, setOpen] = React.useState(false);
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

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 w-full text-center text-sm font-medium text-cyan-700 transition-colors hover:text-cyan-800"
      >
        Forgot your password?
      </button>
    );
  }

  return (
    <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50/70 p-4">
      {state === "sent" ? (
        <div className="flex items-start gap-2.5 text-sm text-emerald-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{message}</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="reset-email">Reset password</Label>
            <p className="text-xs text-slate-500">
              Enter your email and we&apos;ll send you a temporary password to sign in with.
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

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={state === "sending"} className="h-9 flex-1">
              <Mail className="h-4 w-4" />
              {state === "sending" ? "Sending…" : "Email me a temporary password"}
            </Button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-9 rounded-md px-3 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
