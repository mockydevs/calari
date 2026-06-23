"use client";
import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle2, Eye, EyeOff, Zap } from "lucide-react";
import { api, extractApiError } from "@/lib/portal/api";
import { Button } from "@/components/portal/button";
import { Field, Input } from "@/components/portal/form";

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [pw, setPw] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [error, setError] = React.useState("");
  const [done, setDone] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return setError("Password must be at least 8 characters.");
    if (pw !== confirm) return setError("Passwords do not match.");
    setError("");
    setLoading(true);
    try {
      await api.post("auth/reset-password-confirm", {
        token,
        new_password: pw,
        confirm_password: confirm,
      });
      setDone(true);
      setTimeout(() => router.push("/staff/login"), 2000);
    } catch (err) {
      setError(extractApiError((err as { body?: unknown }).body, "This reset link is invalid or has expired."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="portal-card w-full max-w-[400px] p-8" style={{ borderColor: "var(--border-strong)" }}>
      <div className="mb-6 flex items-center gap-2.5">
        <span className="portal-logo-icon">
          <Zap className="h-5 w-5" />
        </span>
        <div className="leading-tight">
          <div className="text-[1.1rem] font-bold">Calari</div>
          <div className="portal-text-muted -mt-0.5 text-[0.65rem]">Staff Portal</div>
        </div>
      </div>

      <h1 className="text-[1.35rem] font-bold">Set new password</h1>
      <p className="portal-text-muted mb-6 text-[0.8rem]">Choose a strong password for your account.</p>

      {done ? (
        <div className="portal-alert portal-alert-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>Password updated. Redirecting to sign in…</span>
        </div>
      ) : (
        <form onSubmit={onSubmit}>
          {error && <div className="portal-alert portal-alert-danger mb-4">{error}</div>}
          <Field label="New password">
            <div className="relative">
              <Input
                type={show ? "text" : "password"}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="portal-text-muted absolute right-2 top-1/2 -translate-y-1/2"
                aria-label="Toggle password"
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
          <Field label="Confirm password">
            <Input type={show ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <Button type="submit" loading={loading} className="w-full">
            Update password
          </Button>
        </form>
      )}

      <p className="mt-6 text-center text-[0.72rem]">
        <Link href="/staff/login" style={{ color: "var(--accent-primary)" }}>
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
