import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { createBuild } from "../actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function NewBuildPage() {
  await requireAdmin();
  const clients = await prisma.client.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/builds" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-950">
        <ArrowLeft className="h-4 w-4" />
        Back to builds
      </Link>

      <div>
        <h1 className="text-2xl font-semibold text-slate-950">New build</h1>
        <p className="mt-1 text-sm text-slate-500">Create the client delivery record and paste notes for AI drafting.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-700" />
            Build brief intake
          </CardTitle>
        </CardHeader>
        <CardContent>
          {clients.length === 0 ? (
            <div className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Add a client before creating a build.
              <Link href="/clients" className="ml-2 font-medium text-blue-700 hover:text-blue-800">Open clients</Link>
            </div>
          ) : (
            <form action={createBuild} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="title">Build title</Label>
                <Input id="title" name="title" required placeholder="Acme - lead intake automation" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="clientId">Client</Label>
                <Select id="clientId" name="clientId" required defaultValue="">
                  <option value="" disabled>Select a client...</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>{client.name}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="notes">Client meeting notes</Label>
                <Textarea
                  id="notes"
                  name="notes"
                  rows={12}
                  placeholder="Paste the call notes here. AI will draft the pipeline, sources, manual actions, and tasks for review."
                />
              </div>
              <Button type="submit" className="w-full">Create & continue</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
