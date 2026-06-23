import Link from "next/link";
import { ArrowLeft, ClipboardList, FileText, Plus } from "lucide-react";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { createBuild } from "../actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { IntakeBriefDropzone } from "@/components/intake-brief-dropzone";

export const dynamic = "force-dynamic";

const FORMATS = ["PDF", "DOCX", "TXT", "CSV", "MD", "RTF"];

export default async function NewBuildPage() {
  await requireAdmin();
  const clients = await prisma.client.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <section className="rounded-lg border border-white/80 bg-white/85 p-5 shadow-sm shadow-slate-900/[0.04] backdrop-blur">
        <Link
          href="/builds"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors hover:text-slate-950"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to builds
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
              Intake
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">New build</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {["Client", "Notes", "File", "Brief"].map((item, index) => (
              <span
                key={item}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-600"
              >
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-cyan-600 text-[10px] text-white">
                  {index + 1}
                </span>
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>

      {clients.length === 0 ? (
        <div className="rounded-lg bg-amber-50 px-4 py-3.5 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
          You need to add a client before creating a build.{" "}
          <Link href="/clients" className="font-semibold text-amber-900 underline underline-offset-2 hover:no-underline">
            Manage clients
          </Link>
        </div>
      ) : (
        <form action={createBuild} className="grid items-stretch gap-5 lg:grid-cols-[minmax(0,1fr)_390px] xl:grid-cols-[minmax(0,1fr)_430px]">
          <section className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]">
            <div className="border-b border-cyan-100 bg-cyan-50/55 px-5 py-4 sm:px-6">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-cyan-700 ring-1 ring-cyan-100">
                  <ClipboardList className="h-4 w-4" />
                </span>
                <h2 className="text-sm font-semibold text-slate-950">Build details</h2>
              </div>
            </div>

            <div className="space-y-5 p-5 sm:p-6">
              <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(220px,0.8fr)]">
                <div className="space-y-1.5">
                  <Label htmlFor="title">Build title</Label>
                  <Input
                    id="title"
                    name="title"
                    required
                    placeholder="e.g. Acme - lead intake automation"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="clientId">Client</Label>
                  <Select id="clientId" name="clientId" required defaultValue="">
                    <option value="" disabled>
                      Select a client
                    </option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="notes">Client meeting notes</Label>
                <Textarea
                  id="notes"
                  name="notes"
                  rows={18}
                  className="min-h-[360px] resize-y font-mono text-xs leading-5"
                  placeholder="[Meeting notes go here]"
                />
              </div>
            </div>
          </section>

          <aside className="lg:sticky lg:top-8">
            <section className="flex h-full flex-col overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]">
              <div className="border-b border-emerald-100 bg-emerald-50/60 px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-emerald-700 ring-1 ring-emerald-100">
                      <FileText className="h-4 w-4" />
                    </span>
                    <h2 className="text-sm font-semibold text-slate-950">Brief document</h2>
                  </div>
                  <span className="rounded-md bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-100">
                    Optional
                  </span>
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-4 p-5">
                <IntakeBriefDropzone />
                <div className="grid grid-cols-3 gap-2">
                  {FORMATS.map((format) => (
                    <span
                      key={format}
                      className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-center text-xs font-semibold text-slate-600"
                    >
                      {format}
                    </span>
                  ))}
                </div>
                <Button type="submit" className="mt-auto h-11 w-full">
                  <Plus className="h-4 w-4" />
                  Create build
                </Button>
              </div>
            </section>
          </aside>
        </form>
      )}
    </div>
  );
}
