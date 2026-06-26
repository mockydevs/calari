import { Bot, CheckCircle2, KeyRound, Plus, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { requireAdmin } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import { createApiKey, activateApiKey, deleteApiKey, updateAiConfig } from "./actions";
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

type AiConfig = { provider: string; model: string; blueprint_model: string; multi_pass: boolean };
type AiUsage = {
  days: number;
  totals: {
    calls: number; ok_rate: number; total_tokens: number; prompt_tokens: number;
    completion_tokens: number; avg_latency_ms: number; estimated_cost_usd: number | null;
  };
  by_op: { op: string; calls: number; tokens: number | null; avg_latency_ms: number | null; ok: number }[];
  by_model: { provider: string; model: string; calls: number; tokens: number | null }[];
};

const nfmt = (n: number | null | undefined) => (n ?? 0).toLocaleString();

export default async function AiSettingsPage() {
  await requireAdmin();
  const [keys, config, usage] = await Promise.all([
    serverApi.get<AiKey[] | { results: AiKey[] }>("builds/ai-keys").then(asList).catch(() => [] as AiKey[]),
    serverApi.get<AiConfig>("builds/ai-config").catch(() => ({ provider: "OPENAI", model: "", blueprint_model: "", multi_pass: false } as AiConfig)),
    serverApi.get<AiUsage>("builds/ai-usage").catch(() => null),
  ]);
  // Providers we actually generate with today (others can still store keys).
  const ACTIVE_PROVIDERS = ["OPENAI", "ANTHROPIC"];

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">Admin settings</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">AI providers</h1>
        <p className="mt-1 text-sm text-slate-600">
          Add API keys for OpenAI, Claude, and other providers. Keys are encrypted and only previews are shown.
        </p>
      </div>

      {/* Active provider + model used for generation */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-pink-50 text-pink-700 ring-1 ring-pink-100">
              <Sparkles className="h-4 w-4" />
            </span>
            Active AI provider &amp; model
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateAiConfig} className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="active-provider">Provider</Label>
              <Select id="active-provider" name="provider" defaultValue={config.provider || "OPENAI"}>
                {ACTIVE_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
              </Select>
              <p className="text-xs text-slate-500">Uses that provider&apos;s active key above.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="active-model">Model</Label>
              <Input id="active-model" name="model" defaultValue={config.model} placeholder="e.g. gpt-4o / claude-opus-4-8" />
              <p className="text-xs text-slate-500">Blank = provider default. Any current/future model id works.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="blueprint-model">Blueprint model (optional)</Label>
              <Input id="blueprint-model" name="blueprint_model" defaultValue={config.blueprint_model} placeholder="overrides for the build-out" />
              <p className="text-xs text-slate-500">Blank = same as Model.</p>
            </div>
            <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-3 text-sm sm:col-span-3">
              <input type="checkbox" name="multi_pass" defaultChecked={config.multi_pass} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-pink-700" />
              <span>
                <span className="block font-semibold text-slate-950">Architect → critic multi-pass</span>
                <span className="block text-xs text-slate-500">Runs a second self-review pass to improve completeness on the blueprint. Higher quality, ~2× the blueprint cost.</span>
              </span>
            </label>
            <div className="sm:col-span-3">
              <Button type="submit"><CheckCircle2 className="h-4 w-4" /> Save active provider</Button>
              <span className="ml-3 text-xs text-slate-500">If the chosen provider/model errors, generation safely falls back to OpenAI.</span>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* AI usage telemetry */}
      {usage && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-pink-50 text-pink-700 ring-1 ring-pink-100"><Bot className="h-4 w-4" /></span>
              AI usage — last {usage.days} days
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {([
                ["Calls", nfmt(usage.totals.calls)],
                ["Tokens", nfmt(usage.totals.total_tokens)],
                ["Success", `${usage.totals.ok_rate}%`],
                ["Avg latency", `${nfmt(usage.totals.avg_latency_ms)} ms`],
                ["Est. cost", usage.totals.estimated_cost_usd != null ? `$${usage.totals.estimated_cost_usd.toFixed(2)}` : "—"],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
                </div>
              ))}
            </div>
            {usage.by_op.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead><tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3">Operation</th><th className="py-2 pr-3">Calls</th><th className="py-2 pr-3">Tokens</th><th className="py-2 pr-3">Avg ms</th><th className="py-2">OK</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-50">{usage.by_op.map((r) => (
                    <tr key={r.op}>
                      <td className="py-2 pr-3 font-medium text-slate-800">{r.op}</td>
                      <td className="py-2 pr-3 text-slate-600">{nfmt(r.calls)}</td>
                      <td className="py-2 pr-3 text-slate-600">{nfmt(r.tokens)}</td>
                      <td className="py-2 pr-3 text-slate-600">{nfmt(r.avg_latency_ms)}</td>
                      <td className="py-2 text-slate-600">{r.ok}/{r.calls}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No AI calls recorded yet.</p>
            )}
            {usage.by_model.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {usage.by_model.map((m) => (
                  <span key={`${m.provider}-${m.model}`} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{m.model || m.provider}: {nfmt(m.tokens)} tok</span>
                ))}
              </div>
            )}
            <p className="text-[11px] text-slate-400">Cost is an estimate from public token pricing and may drift.</p>
          </CardContent>
        </Card>
      )}

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
