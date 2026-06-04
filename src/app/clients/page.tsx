import { Building2, Plus } from "lucide-react";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { createClient } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  await requireAdmin();
  const clients = await prisma.client.findMany({
    include: { _count: { select: { builds: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Clients</h1>
          <p className="mt-1 text-sm text-slate-500">Manage the client records used for build intake and reporting.</p>
        </div>
        <Card>
          <CardContent className="p-0">
            {clients.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">No clients yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[580px] text-sm">
                  <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Name</th>
                      <th className="px-5 py-3 font-semibold">Company</th>
                      <th className="px-5 py-3 font-semibold">Builds</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {clients.map((client) => (
                      <tr key={client.id} className="bg-white">
                        <td className="px-5 py-3 font-medium text-slate-950">{client.name}</td>
                        <td className="px-5 py-3 text-slate-600">{client.company ?? "-"}</td>
                        <td className="px-5 py-3 text-slate-600">{client._count.builds}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-blue-700" />
            Add client
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createClient} className="space-y-3">
            <div className="space-y-1"><Label htmlFor="name">Name</Label><Input id="name" name="name" required /></div>
            <div className="space-y-1"><Label htmlFor="company">Company</Label><Input id="company" name="company" /></div>
            <div className="space-y-1"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" /></div>
            <div className="space-y-1"><Label htmlFor="notes">Notes</Label><Textarea id="notes" name="notes" /></div>
            <Button type="submit" className="w-full">
              <Plus className="h-4 w-4" />
              Create client
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
