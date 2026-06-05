import { Clock, MailPlus, ShieldCheck, Trash2, UserCheck, Users } from "lucide-react";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { approveUser, cancelInvite, createInvite, deactivateUser } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ROLE_STYLES: Record<string, string> = {
  ADMIN: "bg-cyan-50 text-cyan-700",
  MEMBER: "bg-slate-100 text-slate-600",
};

export default async function TeamPage() {
  const admin = await requireAdmin();
  const [users, invites] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.teamInvite.findMany({
      where: { acceptedAt: null, expiresAt: { gt: new Date() } },
      include: { invitedBy: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const pendingUsers = users.filter((user) => !user.active);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
          Admin
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Team</h1>
        <p className="mt-1 text-sm text-slate-600">
          Invite team members, approve self-signups, and manage access.
        </p>
      </div>

      {pendingUsers.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-amber-200 bg-white shadow-sm shadow-slate-900/[0.03]">
          <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50 px-5 py-4">
            <Clock className="h-4 w-4 text-amber-700" />
            <h2 className="text-sm font-semibold text-amber-900">Pending self-signups</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="border-b border-slate-100 bg-white">
                <tr>
                  {["Member", "Email", "Requested", "Action"].map((heading) => (
                    <th
                      key={heading}
                      className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pendingUsers.map((user) => (
                  <tr key={user.id} className="transition-colors hover:bg-amber-50/40">
                    <td className="px-5 py-3.5 font-semibold text-slate-950">{user.name}</td>
                    <td className="px-5 py-3.5 text-slate-600">{user.email}</td>
                    <td className="px-5 py-3.5 text-slate-500">{formatDate(user.createdAt)}</td>
                    <td className="px-5 py-3.5">
                      <form action={approveUser}>
                        <input type="hidden" name="id" value={user.id} />
                        <Button size="sm">
                          <UserCheck className="h-3.5 w-3.5" />
                          Approve
                        </Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <section className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]">
            {users.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100">
                  <Users className="h-5 w-5 text-slate-400" />
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-950">No team members</p>
                <p className="mt-1 text-xs text-slate-500">
                  Send an invite using the form.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="border-b border-slate-100 bg-slate-50/80">
                    <tr>
                      {["Member", "Email", "Role", "Status", "Action"].map((h) => (
                        <th
                          key={h}
                          className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {users.map((u) => {
                      const initials = u.name
                        .split(" ")
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase();
                      return (
                        <tr key={u.id} className="transition-colors hover:bg-cyan-50/30">
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-3">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-[10px] font-semibold text-cyan-700 ring-1 ring-cyan-100">
                                {initials}
                              </span>
                              <span className="font-semibold text-slate-950">{u.name}</span>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-slate-600">{u.email}</td>
                          <td className="px-5 py-3.5">
                            <span
                              className={cn(
                                "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold",
                                ROLE_STYLES[u.role] ?? "bg-slate-100 text-slate-600",
                              )}
                            >
                              {u.role}
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold",
                                u.active
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-amber-50 text-amber-700",
                              )}
                            >
                              <span
                                className={cn(
                                  "h-1.5 w-1.5 rounded-full",
                                  u.active ? "bg-emerald-500" : "bg-amber-500",
                                )}
                              />
                              {u.active ? "Active" : "Pending approval"}
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            {u.active && u.id !== admin.id ? (
                              <form action={deactivateUser}>
                                <input type="hidden" name="id" value={u.id} />
                                <Button size="sm" variant="outline">
                                  Deactivate
                                </Button>
                              </form>
                            ) : !u.active ? (
                              <form action={approveUser}>
                                <input type="hidden" name="id" value={u.id} />
                                <Button size="sm">
                                  Approve
                                </Button>
                              </form>
                            ) : (
                              <span className="text-xs text-slate-400">Current admin</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]">
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-5 py-4">
              <MailPlus className="h-4 w-4 text-cyan-700" />
              <h2 className="text-sm font-semibold text-slate-950">Outstanding admin invites</h2>
            </div>
            {invites.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-500">No pending admin invites.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="border-b border-slate-100 bg-white">
                    <tr>
                      {["Invitee", "Role", "Sent by", "Expires", "Action"].map((heading) => (
                        <th
                          key={heading}
                          className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invites.map((invite) => (
                      <tr key={invite.id} className="transition-colors hover:bg-cyan-50/30">
                        <td className="px-5 py-3.5">
                          <p className="font-semibold text-slate-950">{invite.name}</p>
                          <p className="text-xs text-slate-500">{invite.email}</p>
                        </td>
                        <td className="px-5 py-3.5 text-slate-600">{invite.role}</td>
                        <td className="px-5 py-3.5 text-slate-500">{invite.invitedBy.name}</td>
                        <td className="px-5 py-3.5 text-slate-500">{formatDate(invite.expiresAt)}</td>
                        <td className="px-5 py-3.5">
                          <form action={cancelInvite}>
                            <input type="hidden" name="id" value={invite.id} />
                            <button
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                              aria-label={`Cancel invite for ${invite.email}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100">
                <MailPlus className="h-4 w-4" />
              </span>
              Invite member
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createInvite} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name</Label>
                <Input id="name" name="name" required placeholder="Jane Smith" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required placeholder="jane@calari.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role">Role</Label>
                <Select id="role" name="role" defaultValue="MEMBER">
                  <option value="MEMBER">Member</option>
                  <option value="ADMIN">Admin</option>
                </Select>
              </div>
              <div className="rounded-lg bg-cyan-50 px-3 py-3 text-xs leading-5 text-cyan-800 ring-1 ring-cyan-100">
                <div className="mb-1 flex items-center gap-2 font-semibold">
                  <ShieldCheck className="h-4 w-4" />
                  Admin invite
                </div>
                Invited users are active immediately after completing the emailed signup link. Self-signups still require approval.
              </div>
              <Button type="submit" className="w-full">
                <MailPlus className="h-4 w-4" />
                Send invite
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

