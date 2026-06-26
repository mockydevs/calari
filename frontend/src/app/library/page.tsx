import { BookOpen } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import { BuildLibrary } from "./build-library";

export const dynamic = "force-dynamic";

type ClientRow = { id: number; name: string };
function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

export default async function LibraryPage() {
  await requireUser();
  const clients = await serverApi
    .get<ClientRow[] | { results: ClientRow[] }>("projects/clients")
    .then(asList)
    .catch(() => [] as ClientRow[]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-950">
          <BookOpen className="h-6 w-6 text-pink-700" /> Build Library
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Upload past build docs, handovers, and client documentation. Marked docs become
          reference material the AI learns from — improving every blueprint it generates.
        </p>
      </div>
      <BuildLibrary clients={clients.map((c) => ({ id: c.id, name: c.name }))} />
    </div>
  );
}
