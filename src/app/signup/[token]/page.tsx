import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { hashInviteToken } from "@/lib/team-invites";
import { completeSignup } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

export const dynamic = "force-dynamic";

export default async function SignupPage({ params }: { params: Promise<{ token: string }> }) {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  const { token } = await params;
  const invite = await prisma.teamInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
  });

  if (!invite) notFound();
  const expired = invite.expiresAt < new Date();
  const unavailable = expired || !!invite.acceptedAt;

  return (
    <main className="flex min-h-screen bg-slate-950 text-white">
      <div className="hidden w-[440px] shrink-0 flex-col justify-between border-r border-white/[0.08] bg-slate-950 p-10 lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-emerald-500 text-sm font-black text-white shadow-lg shadow-cyan-950/40">
            CI
          </span>
          <span className="text-sm font-semibold text-white">Calari Internal</span>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">
            Team signup
          </p>
          <h1 className="mt-4 max-w-sm text-4xl font-semibold leading-tight tracking-tight">
            Create your delivery workspace account.
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-6 text-slate-400">
            Admin-invited users can sign in as soon as this signup is complete.
          </p>
        </div>
        <p className="text-xs text-slate-500">Calari Solutions</p>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center bg-[linear-gradient(180deg,#ecfeff_0%,#f8fafc_46%,#eef2f7_100%)] px-6 py-12 text-slate-950">
        <div className="w-full max-w-md rounded-lg border border-white/80 bg-white/90 p-8 shadow-xl shadow-slate-900/10 backdrop-blur">
          <div className="mb-7">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
              Invitation
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              Complete signup
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">
              Invited as {invite.email}
            </p>
          </div>

          {unavailable ? (
            <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
              This invite link is {expired ? "expired" : "already used"}. Ask an admin to send a new invitation.
            </div>
          ) : (
            <form action={completeSignup} className="space-y-4">
              <input type="hidden" name="token" value={token} />
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name</Label>
                <Input id="name" name="name" required defaultValue={invite.name} autoComplete="name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <PasswordInput
                  id="password"
                  name="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirmPassword">Confirm password</Label>
                <PasswordInput
                  id="confirmPassword"
                  name="confirmPassword"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              <Button type="submit" className="w-full">
                Create account
              </Button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
