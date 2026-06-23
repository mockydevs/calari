import { LockKeyhole, Save, UserRound } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { updatePassword } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requireUser();
  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Account</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Profile</h1>
        <p className="mt-1 text-sm text-slate-600">Your account and password.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100">
              <UserRound className="h-4 w-4" />
            </span>
            Identity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-50 text-sm font-semibold text-cyan-700 ring-1 ring-cyan-100">
              {initials}
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-950">{user.name}</p>
              <p className="text-xs text-slate-500">{user.email}</p>
              <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-cyan-700">{user.role}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100">
              <LockKeyhole className="h-4 w-4" />
            </span>
            Change password
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updatePassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="currentPassword">Current password</Label>
              <PasswordInput id="currentPassword" name="currentPassword" required autoComplete="current-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newPassword">New password</Label>
              <PasswordInput id="newPassword" name="newPassword" required autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <PasswordInput id="confirmPassword" name="confirmPassword" required autoComplete="new-password" />
            </div>
            <Button type="submit">
              <Save className="h-4 w-4" />
              Update password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
