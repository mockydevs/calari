import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireFeature } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import { NewBuildForm } from "./new-build-form";

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
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <div>
        <Link href="/builds" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors hover:text-slate-950">
          <ArrowLeft className="h-4 w-4" /> Back to builds
        </Link>
        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">Intake</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">New build</h1>
        <p className="mt-1 text-sm text-slate-600">Name the build, pick the client, and add the call notes — paste them or upload the documents.</p>
      </div>

      {clients.length === 0 ? (
        <div className="rounded-lg bg-amber-50 px-4 py-3.5 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
          You need to add a client before creating a build.{" "}
          <Link href="/clients" className="font-semibold text-amber-900 underline underline-offset-2 hover:no-underline">Manage clients</Link>
        </div>
      ) : (
        <NewBuildForm clients={clients} />
      )}
    </div>
  );
}
