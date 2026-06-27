import Link from "next/link";
import { ArrowLeft, ClipboardList, Plus } from "lucide-react";
import { requireFeature } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import { createBuild } from "../actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

type DjangoClient = { id: number; name: string };

function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

export default async function NewBuildPage() {
  await requireFeature("builds_manage");
  const clients = await serverApi
    .get<DjangoClient[] | { results: DjangoClient[] }>("projects/clients")
    .then(asList)
    .catch(() => [] as DjangoClient[]);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <section className="rounded-lg border border-white/80 bg-white/85 p-5 shadow-sm shadow-slate-900/[0.04] backdrop-blur">
        <Link href="/builds" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors hover:text-slate-950">
          <ArrowLeft className="h-4 w-4" />
          Back to builds
        </Link>
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">Intake</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">New build</h1>
        </div>
      </section>

      {clients.length === 0 ? (
        <div className="rounded-lg bg-amber-50 px-4 py-3.5 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
          You need to add a client before creating a build.{" "}
          <Link href="/clients" className="font-semibold text-amber-900 underline underline-offset-2 hover:no-underline">Manage clients</Link>
        </div>
      ) : (
        <section className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]">
          <div className="border-b border-pink-100 bg-pink-50/55 px-5 py-4">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-pink-700 ring-1 ring-pink-100">
                <ClipboardList className="h-4 w-4" />
              </span>
              <h2 className="text-sm font-semibold text-slate-950">Build details</h2>
            </div>
          </div>
          <form action={createBuild} className="space-y-5 p-5 sm:p-6">
            <div className="space-y-1.5">
              <Label htmlFor="title">Build title</Label>
              <Input id="title" name="title" required placeholder="e.g. Acme - lead intake automation" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client">Client</Label>
              <Select id="client" name="client" required defaultValue="">
                <option value="" disabled>Select a client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Client meeting notes</Label>
              <Textarea
                id="notes"
                name="notes"
                rows={10}
                className="min-h-[200px] resize-y font-mono text-xs leading-5"
                placeholder="Paste the client call notes here — the AI brief is generated from these on the build page."
              />
              <p className="text-xs text-slate-500">Optional now — you can also add notes later, then generate the brief from the build.</p>
            </div>
            <Button type="submit" className="h-11 w-full">
              <Plus className="h-4 w-4" />
              Create build
            </Button>
          </form>
        </section>
      )}
    </div>
  );
}
