import { Cable, CheckCircle2, KeyRound, Plus, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { requireFeature } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import { createConnection, activateConnection, deleteConnection, renameConnection } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PROVIDER_LABELS: Record<string, string> = {
  FIREFLIES: "Fireflies",
  ASANA: "Asana",
  SLACK: "Slack",
  GDRIVE: "Google Drive",
};
const PROVIDERS = Object.keys(PROVIDER_LABELS);

type Connection = {
  id: number;
  provider: string;
  auth_type: string;
  label: string;
  secret_preview: string;
  workspace_ref: string;
  active: boolean;
  updated_at: string;
};

function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

export default async function ConnectionsPage() {
  await requireFeature("ai_keys");
  const connections = await serverApi
    .get<Connection[] | { results: Connection[] }>("onboarding/connections")
    .then(asList)
    .catch(() => [] as Connection[]);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">Admin settings</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Integrations</h1>
        <p className="mt-1 text-sm text-slate-600">
          Connect Fireflies, Asana, Slack, and Google Drive for the onboarding-intelligence pipeline.
          Tokens are encrypted and only previews are shown. Map each client to its channels/projects in{" "}
          <Link href="/settings/integration-maps" className="font-semibold text-pink-700 hover:underline">client integrations</Link>.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_390px]">
        <div className="space-y-4">
          {PROVIDERS.map((provider) => {
            const providerConns = connections.filter((c) => c.provider === provider);
            const activeConn = providerConns.find((c) => c.active);
            return (
              <section key={provider} className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-pink-50 text-pink-700 ring-1 ring-pink-100">
                      <Cable className="h-4 w-4" />
                    </span>
                    <div>
                      <h2 className="text-sm font-semibold text-slate-950">{PROVIDER_LABELS[provider]}</h2>
                      <p className="text-xs text-slate-500">{activeConn ? `Active: ${activeConn.secret_preview}` : "Not connected"}</p>
                    </div>
                  </div>
                  {activeConn
                    ? <Badge className="bg-emerald-50 text-emerald-700"><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Connected</Badge>
                    : <Badge className="bg-slate-100 text-slate-600">Not configured</Badge>}
                </div>

                {providerConns.length === 0 ? (
                  <div className="px-5 py-4 text-sm text-slate-500">Add a {PROVIDER_LABELS[provider]} connection using the form.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[620px] text-sm">
                      <thead className="border-b border-slate-100 bg-white">
                        <tr>
                          {["Label", "Token", "Workspace", "Updated", "Actions"].map((h) => (
                            <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {providerConns.map((c) => (
                          <tr key={c.id} className="transition-colors hover:bg-pink-50/30">
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-950">{c.label || "—"}</span>
                                {c.active && <Badge className="bg-emerald-50 text-emerald-700">active</Badge>}
                              </div>
                            </td>
                            <td className="px-5 py-3.5 font-mono text-xs text-slate-600">{c.secret_preview}</td>
                            <td className="px-5 py-3.5 text-xs text-slate-500">{c.workspace_ref || "—"}</td>
                            <td className="px-5 py-3.5 text-slate-500">{formatDate(c.updated_at)}</td>
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-2">
                                {!c.active && (
                                  <form action={activateConnection}>
                                    <input type="hidden" name="id" value={c.id} />
                                    <Button size="sm" variant="outline">Activate</Button>
                                  </form>
                                )}
                                <details className="relative">
                                  <summary className="inline-flex h-8 cursor-pointer list-none items-center rounded-md border border-slate-200 px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Rename</summary>
                                  <form action={renameConnection} className="absolute right-0 z-10 mt-1 flex w-60 items-center gap-1.5 rounded-md border border-slate-200 bg-white p-2 shadow-md">
                                    <input type="hidden" name="id" value={c.id} />
                                    <input name="label" defaultValue={c.label} className="h-8 w-full rounded-md border border-slate-200 px-2 text-sm outline-none focus:border-pink-400" />
                                    <Button type="submit" size="sm">Save</Button>
                                  </form>
                                </details>
                                <form action={deleteConnection}>
                                  <input type="hidden" name="id" value={c.id} />
                                  <button className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600" aria-label={`Delete ${c.label}`}>
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </form>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-pink-50 text-pink-700 ring-1 ring-pink-100"><KeyRound className="h-4 w-4" /></span>
              Add connection
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createConnection} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="provider">Provider</Label>
                <Select id="provider" name="provider" defaultValue="FIREFLIES">
                  {PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="auth_type">Auth type</Label>
                <Select id="auth_type" name="auth_type" defaultValue="api_key">
                  <option value="api_key">API key / token</option>
                  <option value="oauth">OAuth token</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="label">Label</Label>
                <Input id="label" name="label" placeholder="e.g. Company Slack bot" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="secret">Token / API key</Label>
                <PasswordInput id="secret" name="secret" required autoComplete="off" placeholder="Paste token" />
                <p className="text-xs text-slate-500">Encrypted before storage; cannot be viewed again.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="workspace_ref">Workspace ref (optional)</Label>
                <Input id="workspace_ref" name="workspace_ref" placeholder="team / workspace / drive id" />
              </div>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-3 text-sm">
                <input name="active" type="checkbox" defaultChecked className="mt-1 h-4 w-4 rounded border-slate-300 text-pink-700" />
                <span>
                  <span className="block font-semibold text-slate-950">Make active for this provider</span>
                  <span className="block text-xs text-slate-500">Activating disables other active connections for the same provider.</span>
                </span>
              </label>
              <div className="rounded-lg bg-pink-50 px-3 py-3 text-xs leading-5 text-pink-800 ring-1 ring-pink-100">
                <div className="mb-1 flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" /> Security note</div>
                Tokens are encrypted at rest with the same crypto as AI provider keys.
              </div>
              <Button type="submit" className="w-full"><Plus className="h-4 w-4" /> Save connection</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
