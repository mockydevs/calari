import { redirect } from "next/navigation";
import { getAppUser } from "@/lib/auth-helpers";
import { portalLogin } from "@/lib/portal/server";
import { AlertCircle, CheckCircle2, LockKeyhole, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { ForgotPassword } from "./forgot-password";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getAppUser()) redirect("/dashboard");
  const { error } = await searchParams;

  async function login(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    // Single source of truth: Django. Sets the httpOnly JWT cookies.
    const user = await portalLogin(email, password);
    if (!user) redirect("/login?error=1");
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen bg-slate-950 text-white">
      <div className="hidden w-[480px] shrink-0 flex-col justify-between border-r border-white/[0.08] bg-slate-950 p-10 lg:flex">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="Calari" className="h-8 w-auto" />
        </div>

        <div className="space-y-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">
              Delivery operations
            </p>
            <h1 className="mt-4 max-w-sm text-4xl font-semibold leading-tight tracking-tight">
              Clear briefs, assigned work, and clean handoffs.
            </h1>
            <p className="mt-4 max-w-sm text-sm leading-6 text-slate-400">
              One internal workspace for Calari builds from client intake through final delivery.
            </p>
          </div>

          <div className="grid gap-3 text-sm text-slate-300">
            {["AI-assisted build briefs", "Role-aware admin controls", "Task, file, and review tracking"].map(
              (item) => (
                <div key={item} className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-cyan-500/10 text-cyan-300 ring-1 ring-cyan-300/15">
                    <CheckCircle2 className="h-4 w-4" />
                  </span>
                  {item}
                </div>
              ),
            )}
          </div>
        </div>

        <p className="text-xs text-slate-500">Calari Solutions</p>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center bg-[linear-gradient(180deg,#ecfeff_0%,#f8fafc_46%,#eef2f7_100%)] px-6 py-12 text-slate-950">
        <div className="mb-8 flex items-center gap-3 lg:hidden">
          <span className="inline-flex items-center rounded-lg bg-slate-950 px-3 py-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="Calari" className="h-6 w-auto" />
          </span>
        </div>

        <div className="w-full max-w-md rounded-lg border border-white/80 bg-white/90 p-8 shadow-xl shadow-slate-900/10 backdrop-blur">
          <div className="mb-7">
            <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100">
              <LockKeyhole className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Sign in</h1>
            <p className="mt-1.5 text-sm text-slate-500">
              Access client delivery, reviews, and admin tools.
            </p>
          </div>

          <form action={login} className="space-y-4">
            {error && (
              <div className="flex items-center gap-2.5 rounded-md bg-red-50 px-3.5 py-3 text-sm text-red-700 ring-1 ring-inset ring-red-200">
                <AlertCircle className="h-4 w-4 shrink-0" />
                Invalid email or password.
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@calari.com"
                className="h-10"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <PasswordInput
                id="password"
                name="password"
                required
                autoComplete="current-password"
                className="h-10"
              />
            </div>

            <Button type="submit" className="mt-1 h-10 w-full">
              <Workflow className="h-4 w-4" />
              Sign in to Calari Internal
            </Button>
          </form>

          <ForgotPassword />

          <p className="mt-8 text-center text-xs text-slate-400">
            (c) {new Date().getFullYear()} Calari Solutions - All rights reserved
          </p>
        </div>
      </div>
    </div>
  );
}
