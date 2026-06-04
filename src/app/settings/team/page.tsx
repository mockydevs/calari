import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { createMember } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  await requireAdmin();
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div className="md:col-span-2 space-y-4">
        <h1 className="text-2xl font-semibold">Team</h1>
        <Card><CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-slate-500"><tr><th className="px-5 py-3 font-medium">Name</th><th className="px-5 py-3 font-medium">Email</th><th className="px-5 py-3 font-medium">Role</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-50"><td className="px-5 py-3 font-medium">{u.name}</td><td className="px-5 py-3 text-slate-600">{u.email}</td><td className="px-5 py-3"><Badge className="bg-slate-100 text-slate-700">{u.role}</Badge></td></tr>
              ))}
            </tbody>
          </table>
        </CardContent></Card>
      </div>
      <div>
        <Card>
          <CardHeader><CardTitle>Add member</CardTitle></CardHeader>
          <CardContent>
            <form action={createMember} className="space-y-3">
              <div className="space-y-1"><Label htmlFor="name">Name</Label><Input id="name" name="name" required /></div>
              <div className="space-y-1"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required /></div>
              <div className="space-y-1"><Label htmlFor="password">Temp password</Label><Input id="password" name="password" type="text" required /></div>
              <div className="space-y-1"><Label htmlFor="role">Role</Label><Select id="role" name="role" defaultValue="MEMBER"><option value="MEMBER">Member</option><option value="ADMIN">Admin</option></Select></div>
              <Button type="submit" className="w-full">Add member</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
