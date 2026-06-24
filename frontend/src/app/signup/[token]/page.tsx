"use client";
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, LockKeyhole } from "lucide-react";
import { api, ApiError } from "@/lib/portal/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/toast";

type Invite = { valid: boolean; email?: string; name?: string; role?: string; error?: string };

export default function SignupPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [invite, setInvite] = React.useState<Invite | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [done, setDone] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    api.get<Invite>(`builds/invite/${token}`)
      .then((d) => setInvite(d))
      .catch((e) => setInvite({ valid: false, error: e instanceof ApiError ? e.message : "Invalid invite." }))
      .finally(() => setLoading(false));
  }, [token]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get("password") ?? "");
    const confirm = String(fd.get("confirm") ?? "");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("Passwords do not match.");
    setSubmitting(true);
    try {
      await api.post(`builds/invite/${token}/accept`, { password });
      setDone(true);
      setTimeout(() => router.push("/login"), 1800);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create your account.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#fdf2f8_0%,#f8fafc_46%,#eef2f7_100%)] px-6 py-12 text-slate-950">
      <div className="w-full max-w-md rounded-lg border border-white/80 bg-white/90 p-8 shadow-xl shadow-slate-900/10 backdrop-blur">
        <div className="mb-6 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <span className="inline-flex items-center rounded-lg bg-slate-950 px-3 py-2"><img src="/logo.svg" alt="Calari" className="h-6 w-auto" /></span>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-slate-500"><Spinner /> Checking your invite…</div>
        ) : !invite?.valid ? (
          <div className="space-y-2">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-red-50 text-red-600 ring-1 ring-red-100"><AlertCircle className="h-5 w-5" /></div>
            <h1 className="text-xl font-semibold text-slate-950">Invite not valid</h1>
            <p className="text-sm text-slate-600">{invite?.error || "This invite link is invalid or has expired. Ask an admin to resend it."}</p>
            <a href="/login" className="inline-block pt-2 text-sm font-semibold text-pink-700 hover:text-pink-800">Go to sign in →</a>
          </div>
        ) : done ? (
          <div className="space-y-2">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100"><CheckCircle2 className="h-5 w-5" /></div>
            <h1 className="text-xl font-semibold text-slate-950">Account created</h1>
            <p className="text-sm text-slate-600">Taking you to sign in…</p>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-pink-50 text-pink-700 ring-1 ring-pink-100"><LockKeyhole className="h-5 w-5" /></div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Set your password</h1>
              <p className="mt-1.5 text-sm text-slate-500">Welcome, {invite.name || invite.email}. Create a password to finish setting up your Calari account.</p>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email-display">Email</Label>
                <input id="email-display" value={invite.email} disabled className="h-10 w-full rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500" />
              </div>
              <div className="space-y-1.5"><Label htmlFor="password">Password</Label><PasswordInput id="password" name="password" required autoComplete="new-password" className="h-10" /></div>
              <div className="space-y-1.5"><Label htmlFor="confirm">Confirm password</Label><PasswordInput id="confirm" name="confirm" required autoComplete="new-password" className="h-10" /></div>
              {error && (
                <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2.5 text-sm text-red-700 ring-1 ring-inset ring-red-200"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>
              )}
              <Button type="submit" disabled={submitting} className="h-10 w-full">{submitting ? <><Spinner /> Creating…</> : "Create account"}</Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
