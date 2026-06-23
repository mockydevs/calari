import { Clock, MailPlus, ShieldCheck, Trash2, UserCheck, Users } from "lucide-react";
import { requireAdmin } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import { approveUser, cancelInvite, createInvite, deactivateUser } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

type DUser = { id: number; username: string; email: string; full_name: string; role: string; is_active: boolean; date_joined: string };
type DInvite = { id: number; name: string; email: string; role: string; expires_at: string };

const ROLE_STYLES: Record<string, string> = {
  superuser: "bg-violet-50 text-violet-700",
  admin: "bg-cyan-50 text-cyan-700",
  employee: "bg-slate-100 text-slate-600",
  finance: "bg-amber-50 text-amber-700",
};

function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

export default async function TeamPage() {
  const admin = await requireAdmin();
  const [users, invites] = await Promise.all([
    serverApi.get<DUser[] | { results: DUser[] }>("auth/users").then(asList).catch(() => [] as DUser[]),
    serverApi.get<DInvite[] | { results: DInvite[] }>("builds/team-invites").then(asList).catch(() => [] as DInvite[]),
  ]);
  const pendingUsers = users.filter((u) => !u.is_active);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Admin</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Team</h1>
        <p className="mt-1 text-sm text-slate-600">Invite team members and manage access.</p>
      </div>

      {pendingUsers.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-amber-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50 px-5 py-4">
            <Clock className="h-4 w-4 text-amber-700" />
            <h2 className="text-sm font-semibold text-amber-900">Pending activation</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-slate-100 bg-white">
                <tr>{["Member", "Email", "Action"].map((h) => (<th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>))}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pendingUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-amber-50/40">
                    <td className="px-5 py-3.5 font-semibold text-slate-950">{u.full_name || u.username}</td>
                    <td className="px-5 py-3.5 text-slate-600">{u.email}</td>
                    <td className="px-5 py-3.5">
                      <form action={approveUser}><input type="hidden" name="id" value={u.id} /><Button size="sm"><UserCheck className="h-3.5 w-3.5" /> Activate</Button></form>
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
          <section className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm">
            {users.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100"><Users className="h-5 w-5 text-slate-400" /></div>
                <p className="mt-3 text-sm font-semibold text-slate-950">No team members</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm">
                  <thead className="border-b border-slate-100 bg-slate-50/80">
                    <tr>{["Member", "Email", "Role", "Status", "Action"].map((h) => (<th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>))}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-cyan-50/30">
                        <td className="px-5 py-3.5 font-semibold text-slate-950">{u.full_name || u.username}</td>
                        <td className="px-5 py-3.5 text-slate-600">{u.email}</td>
                        <td className="px-5 py-3.5">
                          <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold capitalize", ROLE_STYLES[u.role] ?? "bg-slate-100 text-slate-600")}>{u.role}</span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold", u.is_active ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>
                            <span className={cn("h-1.5 w-1.5 rounded-full", u.is_active ? "bg-emerald-500" : "bg-amber-500")} />
                            {u.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          {u.is_active && String(u.id) !== admin.id ? (
                            <form action={deactivateUser}><input type="hidden" name="id" value={u.id} /><Button size="sm" variant="outline">Deactivate</Button></form>
                          ) : !u.is_active ? (
                            <form action={approveUser}><input type="hidden" name="id" value={u.id} /><Button size="sm">Activate</Button></form>
                          ) : (
                            <span className="text-xs text-slate-400">You</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-5 py-4">
              <MailPlus className="h-4 w-4 text-cyan-700" />
              <h2 className="text-sm font-semibold text-slate-950">Outstanding invites</h2>
            </div>
            {invites.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-500">No pending invites.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="border-b border-slate-100 bg-white">
                    <tr>{["Invitee", "Role", "Expires", "Action"].map((h) => (<th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>))}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invites.map((inv) => (
                      <tr key={inv.id} className="hover:bg-cyan-50/30">
                        <td className="px-5 py-3.5"><p className="font-semibold text-slate-950">{inv.name}</p><p className="text-xs text-slate-500">{inv.email}</p></td>
                        <td className="px-5 py-3.5 capitalize text-slate-600">{inv.role}</td>
                        <td className="px-5 py-3.5 text-slate-500">{formatDate(inv.expires_at)}</td>
                        <td className="px-5 py-3.5">
                          <form action={cancelInvite}>
                            <input type="hidden" name="id" value={inv.id} />
                            <button className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600" aria-label="Cancel invite"><Trash2 className="h-4 w-4" /></button>
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
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100"><MailPlus className="h-4 w-4" /></span>
              Invite member
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createInvite} className="space-y-4">
              <div className="space-y-1.5"><Label htmlFor="name">Full name</Label><Input id="name" name="name" required placeholder="Jane Smith" /></div>
              <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required placeholder="jane@calari.com" /></div>
              <div className="space-y-1.5">
                <Label htmlFor="role">Role</Label>
                <Select id="role" name="role" defaultValue="MEMBER"><option value="MEMBER">Member</option><option value="ADMIN">Admin</option></Select>
              </div>
              <div className="rounded-lg bg-cyan-50 px-3 py-3 text-xs leading-5 text-cyan-800 ring-1 ring-cyan-100">
                <div className="mb-1 flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" /> Invite</div>
                The invitee receives an emailed signup link to set their password.
              </div>
              <Button type="submit" className="w-full"><MailPlus className="h-4 w-4" /> Send invite</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
