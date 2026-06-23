"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Eye, EyeOff, LogIn, Zap } from "lucide-react";
import { Button } from "@/components/portal/button";
import { Field, Input, Label } from "@/components/portal/form";

export default function PortalLoginPage() {
  return (
    <React.Suspense fallback={null}>
      <LoginForm />
    </React.Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/staff";

  const [identifier, setIdentifier] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier || !password) {
      setError("Please enter your email/username and password.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username_or_email: identifier, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Invalid credentials.");
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="portal-card w-full max-w-[400px] p-8" style={{ borderColor: "var(--border-strong)" }}>
      <div className="mb-7 flex items-center gap-2.5">
        <span className="portal-logo-icon" style={{ boxShadow: "0 0 14px rgba(59,130,246,0.4)" }}>
          <Zap className="h-5 w-5" />
        </span>
        <div className="leading-tight">
          <div className="text-[1.1rem] font-bold">Calari</div>
          <div className="portal-text-muted -mt-0.5 text-[0.65rem]">Staff Portal</div>
        </div>
      </div>

      <h1 className="text-[1.35rem] font-bold">Welcome back</h1>
      <p className="portal-text-muted mb-6 text-[0.8rem]">Sign in to your workspace</p>

      {error && (
        <div className="portal-alert portal-alert-danger mb-4">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={onSubmit}>
        <Field label="Email or username">
          <Input
            autoFocus
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="you@calari.tech"
            autoComplete="username"
          />
        </Field>

        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between">
            <Label className="mb-0">Password</Label>
            <Link href="/staff/forgot-password" className="text-[0.7rem]" style={{ color: "var(--accent-primary)" }}>
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Input
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="portal-text-muted absolute right-2 top-1/2 -translate-y-1/2"
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <Button type="submit" loading={loading} className="w-full">
          {!loading && <LogIn className="h-4 w-4" />}
          Sign In
        </Button>
      </form>

      <p className="portal-text-muted mt-6 text-center text-[0.65rem]">
        © {new Date().getFullYear()} Calari Solutions. All rights reserved.
      </p>
    </div>
  );
}
