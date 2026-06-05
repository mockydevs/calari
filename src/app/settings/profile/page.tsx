import { LockKeyhole, Save, UserRound } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { updatePassword, updateProfile } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const sessionUser = await requireUser();
  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      name: true,
      email: true,
      image: true,
      title: true,
      phone: true,
      role: true,
      createdAt: true,
    },
  });
  if (!user) return null;

  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <div className="rounded-lg border border-white/80 bg-white/85 p-5 shadow-sm shadow-slate-900/[0.04] backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
          Settings
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Profile</h1>
            <p className="mt-1 text-sm text-slate-500">{user.email}</p>
          </div>
          <span className="rounded-md bg-cyan-50 px-3 py-1.5 text-xs font-semibold capitalize text-cyan-700 ring-1 ring-cyan-100">
            {user.role.toLowerCase()} access
          </span>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100">
                <UserRound className="h-4 w-4" />
              </span>
              Profile details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateProfile} className="space-y-5">
              <div className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                {user.image ? (
                  <span
                    aria-hidden="true"
                    className="h-20 w-20 rounded-full bg-cover bg-center ring-2 ring-white"
                    style={{ backgroundImage: `url(${user.image})` }}
                  />
                ) : (
                  <span className="flex h-20 w-20 items-center justify-center rounded-full bg-cyan-100 text-lg font-semibold text-cyan-800 ring-2 ring-white">
                    {initials}
                  </span>
                )}
                <div className="min-w-[220px] flex-1 space-y-2">
                  <Label htmlFor="avatar">Profile picture</Label>
                  <Input
                    id="avatar"
                    name="avatar"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="h-10 cursor-pointer"
                  />
                  <Input
                    name="imageUrl"
                    defaultValue={user.image ?? ""}
                    placeholder="Or paste image URL"
                    className="h-10"
                  />
                  {user.image && (
                    <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                      <input
                        name="removeImage"
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-cyan-700"
                      />
                      Remove current picture
                    </label>
                  )}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Full name</Label>
                  <Input id="name" name="name" required defaultValue={user.name} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" value={user.email} disabled />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="title">Title</Label>
                  <Input id="title" name="title" defaultValue={user.title ?? ""} placeholder="Delivery specialist" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" name="phone" defaultValue={user.phone ?? ""} placeholder="+1 555 0100" />
                </div>
              </div>

              <Button type="submit">
                <Save className="h-4 w-4" />
                Save profile
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                <LockKeyhole className="h-4 w-4" />
              </span>
              Password
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
                <PasswordInput id="newPassword" name="newPassword" required minLength={8} autoComplete="new-password" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirmPassword">Confirm password</Label>
                <PasswordInput id="confirmPassword" name="confirmPassword" required minLength={8} autoComplete="new-password" />
              </div>
              <Button type="submit" variant="outline" className="w-full">
                Update password
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-500">
        Member since {user.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
      </div>
    </div>
  );
}
