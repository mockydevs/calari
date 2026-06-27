import { FolderKanban } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import { type Project } from "@/lib/portal/types";
import { ProjectFormButton, type Option } from "./project-form";
import { ProjectsTable } from "./projects-table";

export const dynamic = "force-dynamic";

type ClientRow = { id: number; name: string };
type UserRow = { id: number; full_name?: string; username?: string };

function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

export default async function ProjectsPage() {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";

  const [projects, clients, users] = await Promise.all([
    serverApi.get<Project[] | { results: Project[] }>("projects/my-projects").then(asList).catch(() => [] as Project[]),
    isAdmin
      ? serverApi.get<ClientRow[] | { results: ClientRow[] }>("projects/clients").then(asList).catch(() => [] as ClientRow[])
      : Promise.resolve([] as ClientRow[]),
    isAdmin
      ? serverApi.get<UserRow[] | { results: UserRow[] }>("auth/users").then(asList).catch(() => [] as UserRow[])
      : Promise.resolve([] as UserRow[]),
  ]);

  const clientOptions: Option[] = clients.map((c) => ({ id: c.id, name: c.name }));
  const userOptions: Option[] = users.map((u) => ({ id: u.id, name: u.full_name || u.username || `User #${u.id}` }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">Delivery</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Projects</h1>
          <p className="mt-1 text-sm text-slate-600">
            Client projects tracked in the Calari portal backend.
          </p>
        </div>
        {isAdmin && <ProjectFormButton clients={clientOptions} users={userOptions} />}
      </div>

      {projects.length === 0 ? (
        <div className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]">
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100">
              <FolderKanban className="h-5 w-5 text-slate-400" />
            </div>
            <p className="mt-3 text-sm font-semibold text-slate-950">No projects yet</p>
            <p className="mt-1 text-xs text-slate-500">Projects created in the portal will appear here.</p>
          </div>
        </div>
      ) : (
        <ProjectsTable projects={projects} />
      )}
    </div>
  );
}
