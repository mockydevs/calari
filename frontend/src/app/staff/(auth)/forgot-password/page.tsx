"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Zap } from "lucide-react";
import { api, extractApiError } from "@/lib/portal/api";
import { Button } from "@/components/portal/button";
import { Field, Input } from "@/components/portal/form";

export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState("");
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) {
      setError("Please enter your email.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await api.post("auth/forgot-password", { email });
      setDone(true);
    } catch (err) {
      setError(extractApiError((err as { body?: unknown }).body, "Something went wrong."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="portal-card w-full max-w-[400px] p-8" style={{ borderColor: "var(--border-strong)" }}>
      <Link href="/staff/login" className="portal-text-muted mb-5 inline-flex items-center gap-1 text-[0.72rem]">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
      </Link>

      <div className="mb-6 flex items-center gap-2.5">
        <span className="portal-logo-icon">
          <Zap className="h-5 w-5" />
        </span>
        <div className="leading-tight">
          <div className="text-[1.1rem] font-bold">Calari</div>
          <div className="portal-text-muted -mt-0.5 text-[0.65rem]">Staff Portal</div>
        </div>
      </div>

      <h1 className="text-[1.35rem] font-bold">Reset password</h1>
      <p className="portal-text-muted mb-6 text-[0.8rem]">Enter your account email and we&apos;ll send a reset link.</p>

      {done ? (
        <div className="portal-alert portal-alert-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>If an account with that email exists, a reset link has been sent.</span>
        </div>
      ) : (
        <form onSubmit={onSubmit}>
          {error && <div className="portal-alert portal-alert-danger mb-4">{error}</div>}
          <Field label="Email">
            <Input
              autoFocus
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@calari.tech"
            />
          </Field>
          <Button type="submit" loading={loading} className="w-full">
            Send reset link
          </Button>
        </form>
      )}
    </div>
  );
}
