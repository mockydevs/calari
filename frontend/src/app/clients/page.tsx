import { Building2, Plus, Users } from "lucide-react";
import { requireFeature } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import { createClient } from "./actions";
import { ClientRow } from "./client-row";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

type DjangoClient = {
  id: number;
  name: string;
  company_name: string;
  email: string;
  phone_number: string;
  ghl_location_id?: string;
  is_active: boolean;
};

export default async function ClientsPage() {
  await requireFeature("clients");
  // Consumes the Django backend (projects.Clients) instead of Prisma.
  const clients = await serverApi
    .get<DjangoClient[] | { results: DjangoClient[] }>("projects/clients")
    .then((r) => (Array.isArray(r) ? r : r.results ?? []))
    .catch(() => [] as DjangoClient[]);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">
          Admin
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Clients</h1>
        <p className="mt-1 text-sm text-slate-600">
          Manage the client records used for build intake and reporting.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <Users className="h-4 w-4 text-pink-700" /> All clients
            </h2>
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-500 ring-1 ring-inset ring-slate-200">{clients.length}</span>
          </div>
          {clients.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100">
                <Users className="h-5 w-5 text-slate-400" />
              </div>
              <p className="mt-3 text-sm font-semibold text-slate-950">No clients yet</p>
              <p className="mt-1 text-xs text-slate-500">
                Add your first client using the form.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {clients.map((client) => (
                <ClientRow key={client.id} client={client} />
              ))}
            </div>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-pink-50 text-pink-700 ring-1 ring-pink-100">
                <Building2 className="h-4 w-4" />
              </span>
              Add client
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createClient} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" required placeholder="Jane Smith" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="company">Company</Label>
                <Input id="company" name="company" placeholder="Acme Corp" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" placeholder="jane@acme.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ghl_location_id">GHL location ID</Label>
                <Input id="ghl_location_id" name="ghl_location_id" placeholder="GoHighLevel sub-account id (optional)" />
                <p className="text-xs text-slate-500">Enables AI progress audits against this client&apos;s live GHL account.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" name="notes" rows={3} placeholder="Any relevant context" />
              </div>
              <Button type="submit" className="w-full">
                <Plus className="h-4 w-4" />
                Create client
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
