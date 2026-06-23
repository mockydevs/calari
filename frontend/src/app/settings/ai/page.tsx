import { Bot, CheckCircle2, KeyRound, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { requireAdmin } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import { createApiKey, activateApiKey, deleteApiKey } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PROVIDER_LABELS: Record<string, string> = {
  OPENAI: "OpenAI",
  ANTHROPIC: "Claude / Anthropic",
  GOOGLE: "Google AI",
  GROQ: "Groq",
  MISTRAL: "Mistral",
  OPENROUTER: "OpenRouter",
  OTHER: "Other",
};
const PROVIDERS = Object.keys(PROVIDER_LABELS);

type AiKey = {
  id: number;
  provider: string;
  label: string;
  key_preview: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

export default async function AiSettingsPage() {
  await requireAdmin();
  const keys = await serverApi
    .get<AiKey[] | { results: AiKey[] }>("builds/ai-keys")
    .then(asList)
    .catch(() => [] as AiKey[]);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">Admin settings</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">AI providers</h1>
        <p className="mt-1 text-sm text-slate-600">
          Add API keys for OpenAI, Claude, and other providers. Keys are encrypted and only previews are shown.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_390px]">
        <div className="space-y-4">
          {PROVIDERS.map((provider) => {
            const providerKeys = keys.filter((k) => k.provider === provider);
            const activeKey = providerKeys.find((k) => k.active);
            return (
              <section
                key={provider}
                className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-pink-50 text-pink-700 ring-1 ring-pink-100">
                      <Bot className="h-4 w-4" />
                    </span>
                    <div>
                      <h2 className="text-sm font-semibold text-slate-950">{PROVIDER_LABELS[provider]}</h2>
                      <p className="text-xs text-slate-500">
                        {activeKey ? `Active key: ${activeKey.key_preview}` : "No active key"}
                      </p>
                    </div>
                  </div>
                  {activeKey ? (
                    <Badge className="bg-emerald-50 text-emerald-700">
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                      Active
                    </Badge>
                  ) : (
                    <Badge className="bg-slate-100 text-slate-600">Not configured</Badge>
                  )}
                </div>

                {providerKeys.length === 0 ? (
                  <div className="px-5 py-4 text-sm text-slate-500">
                    Add a key for {PROVIDER_LABELS[provider]} using the form.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[620px] text-sm">
                      <thead className="border-b border-slate-100 bg-white">
                        <tr>
                          {["Label", "Preview", "Updated", "Actions"].map((heading) => (
                            <th key={heading} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                              {heading}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {providerKeys.map((key) => (
                          <tr key={key.id} className="transition-colors hover:bg-pink-50/30">
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-950">{key.label}</span>
                                {key.active && <Badge className="bg-emerald-50 text-emerald-700">active</Badge>}
                              </div>
                            </td>
                            <td className="px-5 py-3.5 font-mono text-xs text-slate-600">{key.key_preview}</td>
                            <td className="px-5 py-3.5 text-slate-500">{formatDate(key.updated_at)}</td>
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-2">
                                {!key.active && (
                                  <form action={activateApiKey}>
                                    <input type="hidden" name="id" value={key.id} />
                                    <Button size="sm" variant="outline">Activate</Button>
                                  </form>
                                )}
                                <form action={deleteApiKey}>
                                  <input type="hidden" name="id" value={key.id} />
                                  <button
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                                    aria-label={`Delete ${key.label}`}
                                  >
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
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-pink-50 text-pink-700 ring-1 ring-pink-100">
                <KeyRound className="h-4 w-4" />
              </span>
              Add provider key
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createApiKey} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="provider">Provider</Label>
                <Select id="provider" name="provider" defaultValue="OPENAI">
                  {PROVIDERS.map((provider) => (
                    <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="label">Label</Label>
                <Input id="label" name="label" required placeholder="Production OpenAI" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="apiKey">API key</Label>
                <PasswordInput id="apiKey" name="apiKey" required autoComplete="off" placeholder="Paste provider API key" />
                <p className="text-xs text-slate-500">The key is encrypted before storage and cannot be viewed again.</p>
              </div>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-3 text-sm">
                <input name="active" type="checkbox" defaultChecked className="mt-1 h-4 w-4 rounded border-slate-300 text-pink-700" />
                <span>
                  <span className="block font-semibold text-slate-950">Make active for this provider</span>
                  <span className="block text-xs text-slate-500">Activating this key disables other active keys for the same provider.</span>
                </span>
              </label>
              <div className="rounded-lg bg-pink-50 px-3 py-3 text-xs leading-5 text-pink-800 ring-1 ring-pink-100">
                <div className="mb-1 flex items-center gap-2 font-semibold">
                  <ShieldCheck className="h-4 w-4" />
                  Security note
                </div>
                Store provider keys here instead of editing server env files when admins need to rotate keys.
              </div>
              <Button type="submit" className={cn("w-full")}>
                <Plus className="h-4 w-4" />
                Save API key
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
