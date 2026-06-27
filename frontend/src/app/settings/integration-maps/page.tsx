import { CheckCircle2, Link2, Trash2 } from "lucide-react";
import Link from "next/link";
import { requireFeature } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import { saveIntegrationMap, deleteIntegrationMap } from "./actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

type ClientRow = { id: number; name: string };
type IntegrationMap = {
  id: number;
  client: number;
  client_name?: string | null;
  client_number: string;
  drive_folder_id: string;
  drive_onboarding_doc_id: string;
  asana_project_gid: string;
  slack_internal_channel_id: string;
  slack_external_channel_id: string;
  match_domains: string;
  match_emails: string;
  active: boolean;
};

function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

const FIELD_DEFS: { name: keyof IntegrationMap; label: string; placeholder: string }[] = [
  { name: "client_number", label: "Client number", placeholder: "017" },
  { name: "asana_project_gid", label: "Asana project GID", placeholder: "1201234567890" },
  { name: "slack_internal_channel_id", label: "Slack internal channel ID", placeholder: "C0123ABCD" },
  { name: "slack_external_channel_id", label: "Slack external channel ID", placeholder: "C0456EFGH (Slack Connect)" },
  { name: "drive_folder_id", label: "Drive folder ID", placeholder: "1AbC…" },
  { name: "drive_onboarding_doc_id", label: "Drive onboarding doc ID", placeholder: "1XyZ…" },
  { name: "match_domains", label: "Match domains", placeholder: "acme.com, acme.io" },
  { name: "match_emails", label: "Match emails", placeholder: "jane@acme.com, bob@acme.com" },
];

function MapForm({ client, map }: { client: ClientRow; map?: IntegrationMap }) {
  return (
    <form action={saveIntegrationMap} className="space-y-3 px-5 py-4">
      <input type="hidden" name="client" value={client.id} />
      {map && <input type="hidden" name="id" value={map.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELD_DEFS.map((f) => (
          <div key={f.name} className="space-y-1">
            <Label htmlFor={`${client.id}-${f.name}`} className="text-xs">{f.label}</Label>
            <Input
              id={`${client.id}-${f.name}`}
              name={f.name}
              defaultValue={(map?.[f.name] as string) ?? ""}
              placeholder={f.placeholder}
              className="h-9"
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input name="active" type="checkbox" defaultChecked={map?.active ?? false} className="h-4 w-4 rounded border-slate-300 text-pink-700" />
          Automation active for this client
        </label>
        <div className="flex items-center gap-2">
          {map && (
            <form action={deleteIntegrationMap}>
              <input type="hidden" name="id" value={map.id} />
              <Button type="submit" size="sm" variant="outline" className="border-red-200 text-red-700 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /> Remove</Button>
            </form>
          )}
          <Button type="submit" size="sm"><CheckCircle2 className="h-3.5 w-3.5" /> Save mapping</Button>
        </div>
      </div>
    </form>
  );
}

export default async function IntegrationMapsPage() {
  await requireFeature("ai_keys");
  const [clients, maps] = await Promise.all([
    serverApi.get<ClientRow[] | { results: ClientRow[] }>("projects/clients").then(asList).catch(() => [] as ClientRow[]),
    serverApi.get<IntegrationMap[] | { results: IntegrationMap[] }>("onboarding/integration-maps").then(asList).catch(() => [] as IntegrationMap[]),
  ]);
  const mapByClient = new Map(maps.map((m) => [m.client, m]));

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">Admin settings</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Client integrations</h1>
        <p className="mt-1 text-sm text-slate-600">
          Map each client to its Asana project, Slack channels, and Drive folder, and the emails/domains that
          attribute a Fireflies call to them. Set up provider tokens in{" "}
          <Link href="/settings/connections" className="font-semibold text-pink-700 hover:underline">Integrations</Link>.
          Automation only runs for clients marked active.
        </p>
      </div>

      {clients.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">No clients yet.</p>
      ) : (
        <div className="space-y-3">
          {clients.map((client) => {
            const map = mapByClient.get(client.id);
            return (
              <section key={client.id} className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]">
                <details>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink-50 text-pink-700 ring-1 ring-pink-100"><Link2 className="h-4 w-4" /></span>
                      <div>
                        <h2 className="text-sm font-semibold text-slate-950">{client.name}</h2>
                        <p className="text-xs text-slate-500">{map ? `Mapped${map.client_number ? ` · #${map.client_number}` : ""}` : "Not mapped"}</p>
                      </div>
                    </div>
                    {map?.active
                      ? <Badge className="bg-emerald-50 text-emerald-700"><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Active</Badge>
                      : <Badge className="bg-slate-100 text-slate-600">{map ? "Inactive" : "Unmapped"}</Badge>}
                  </summary>
                  <MapForm client={client} map={map} />
                </details>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
