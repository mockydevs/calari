"use client";

import * as React from "react";
import { Upload, Trash2, FileText, Sparkles, Crown, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/portal/api";
import { useToast, Spinner } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";

type Quality = "GOLD" | "STANDARD" | "RAW";
type Doc = {
  id: number; title: string; client_name: string | null; filename: string;
  file_url: string; use_for_ai: boolean; uploaded_by_name: string | null;
  created_at: string; text_chars: number;
  niche: string; build_type: string; ghl_sections: string[]; integrations: string;
  quality: Quality; auto_generated: boolean; enriched_at: string | null; summary: string;
};
type ClientOpt = { id: number; name: string };
type Coverage = {
  total: number; enriched: number; by_quality: Record<string, number>;
  sections: { key: string; label: string; gold: number; any: number; thin: boolean }[];
  embed_model: string; vectors_enabled: boolean;
};

const QUALITY_STYLE: Record<Quality, string> = {
  GOLD: "bg-amber-50 text-amber-700 ring-amber-200",
  STANDARD: "bg-slate-100 text-slate-600 ring-slate-200",
  RAW: "bg-slate-50 text-slate-400 ring-slate-200",
};

export function BuildLibrary({ clients }: { clients: ClientOpt[] }) {
  const toast = useToast();
  const [docs, setDocs] = React.useState<Doc[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [clientId, setClientId] = React.useState("");
  const [niche, setNiche] = React.useState("");
  const [integrations, setIntegrations] = React.useState("");
  const [useForAi, setUseForAi] = React.useState(true);
  const [coverage, setCoverage] = React.useState<Coverage | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = React.useState("");
  const [dragOver, setDragOver] = React.useState(false);

  const loadCoverage = React.useCallback(async () => {
    try {
      setCoverage(await api.get<Coverage>("builds/knowledge/coverage"));
    } catch {
      // coverage is a bonus panel; ignore failures
    }
  }, []);

  const load = React.useCallback(async () => {
    try {
      const res = await api.get<Doc[] | { results: Doc[] }>("builds/knowledge");
      setDocs(Array.isArray(res) ? res : res.results ?? []);
      void loadCoverage();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not load the library.");
    } finally {
      setLoading(false);
    }
  }, [toast, loadCoverage]);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.get<Doc[] | { results: Doc[] }>("builds/knowledge");
        if (active) setDocs(Array.isArray(res) ? res : res.results ?? []);
      } catch {
        // initial load errors are non-fatal; the empty state covers it
      } finally {
        if (active) setLoading(false);
      }
      try {
        const cov = await api.get<Coverage>("builds/knowledge/coverage");
        if (active) setCoverage(cov);
      } catch {
        // coverage is a bonus panel; ignore failures
      }
    })();
    return () => { active = false; };
  }, []);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { toast.error("Choose a file to upload."); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      if (title.trim()) fd.set("title", title.trim());
      if (clientId) fd.set("client", clientId);
      if (niche.trim()) fd.set("niche", niche.trim());
      if (integrations.trim()) fd.set("integrations", integrations.trim());
      fd.set("use_for_ai", String(useForAi));
      await api.upload("builds/knowledge/upload", fd);
      toast.success("Uploaded — AI is summarizing & tagging it in the background.");
      setTitle(""); setClientId(""); setNiche(""); setIntegrations("");
      if (fileRef.current) fileRef.current.value = "";
      setFileName("");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  function remove(d: Doc) {
    toast.confirm({
      title: "Remove document", danger: true, confirmLabel: "Remove",
      message: `Remove "${d.title}" from the library?`,
      onConfirm: async () => {
        try {
          await api.del(`builds/knowledge/${d.id}`);
          setDocs((x) => x.filter((y) => y.id !== d.id));
          toast.success("Removed.");
        } catch (e) {
          toast.error(e instanceof ApiError ? e.message : "Could not remove.");
        }
      },
    });
  }

  async function toggleAi(d: Doc) {
    try {
      await api.patch(`builds/knowledge/${d.id}`, { use_for_ai: !d.use_for_ai });
      setDocs((x) => x.map((y) => (y.id === d.id ? { ...y, use_for_ai: !y.use_for_ai } : y)));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not update.");
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      {/* Library list */}
      <section className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-950">Documents ({docs.length})</h2>
        </div>
        <div className="p-5">
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-slate-500"><Spinner className="h-4 w-4" /> Loading…</p>
          ) : docs.length === 0 ? (
            <p className="text-sm text-slate-500">No documents yet. Upload past build docs so the AI learns how Calari builds.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {docs.map((d) => (
                <li key={d.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                      {d.file_url ? (
                        <a href={d.file_url} target="_blank" rel="noreferrer" className="truncate text-sm font-medium text-pink-700 hover:underline">{d.title}</a>
                      ) : (
                        <span className="truncate text-sm font-medium text-slate-800">{d.title}</span>
                      )}
                      {d.quality === "GOLD" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200" title={d.auto_generated ? "Promoted from a delivered build" : "Gold exemplar"}>
                          <Crown className="h-3 w-3" /> Gold
                        </span>
                      )}
                      {d.use_for_ai && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-pink-50 px-2 py-0.5 text-[10px] font-semibold text-pink-700 ring-1 ring-pink-100">
                          <Sparkles className="h-3 w-3" /> AI learning
                        </span>
                      )}
                      {d.use_for_ai && !d.enriched_at && !d.summary && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 ring-1 ring-slate-200">
                          <Loader2 className="h-3 w-3 animate-spin" /> Enriching…
                        </span>
                      )}
                      {d.niche && (
                        <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200">{d.niche}</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {d.client_name ? `${d.client_name} · ` : ""}{(d.text_chars / 1000).toFixed(1)}k chars
                      {d.ghl_sections?.length ? ` · ${d.ghl_sections.length} section${d.ghl_sections.length > 1 ? "s" : ""}` : ""}
                      {" · "}{d.uploaded_by_name || "—"} · {formatDate(d.created_at)}
                    </p>
                    {d.summary && (
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500">{d.summary}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => toggleAi(d)}
                      title={d.use_for_ai ? "Exclude from AI" : "Include in AI"}
                      className={`rounded p-1.5 ${d.use_for_ai ? "text-pink-600 hover:bg-pink-50" : "text-slate-400 hover:bg-slate-100"}`}>
                      <Sparkles className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => remove(d)} title="Remove"
                      className="rounded p-1.5 text-red-500 hover:bg-red-50">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Upload */}
      <section className="h-fit overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-950"><Upload className="h-4 w-4 text-pink-700" /> Add a document</h2>
        </div>
        <form onSubmit={upload} className="space-y-3 p-5">
          <div className="space-y-1">
            <Label htmlFor="kn-title" className="text-xs">Title (optional)</Label>
            <Input id="kn-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Dental intake build — handover" className="h-9" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="kn-client" className="text-xs">Client (optional)</Label>
            <Select id="kn-client" value={clientId} onChange={(e) => setClientId(e.target.value)} className="h-9">
              <option value="">— General (any client) —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="kn-niche" className="text-xs">Niche (optional)</Label>
              <Input id="kn-niche" value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="e.g. Dental" className="h-9" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="kn-integrations" className="text-xs">Integrations (optional)</Label>
              <Input id="kn-integrations" value={integrations} onChange={(e) => setIntegrations(e.target.value)} placeholder="e.g. Twilio, Stripe" className="h-9" />
            </div>
          </div>
          <p className="text-[11px] text-slate-400">Leave blank and the AI fills the summary, niche, sections &amp; integrations for you.</p>
          <div className="space-y-1">
            <Label htmlFor="kn-file" className="text-xs">File</Label>
            <label
              htmlFor="kn-file"
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f && fileRef.current) { fileRef.current.files = e.dataTransfer.files; setFileName(f.name); }
              }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-7 text-center transition-colors ${
                dragOver ? "border-pink-400 bg-pink-50/70" : "border-slate-300 bg-slate-50/50 hover:border-pink-300 hover:bg-pink-50/30"
              }`}
            >
              <Upload className={`h-6 w-6 ${dragOver ? "text-pink-600" : "text-slate-400"}`} />
              {fileName ? (
                <span className="break-all text-sm font-semibold text-pink-700">{fileName}</span>
              ) : (
                <span className="text-sm font-medium text-slate-700">
                  Click to choose a file <span className="font-normal text-slate-400">or drag &amp; drop</span>
                </span>
              )}
              <span className="text-[11px] text-slate-400">PDF, DOCX, TXT, CSV, MD, RTF — text is extracted for the AI.</span>
            </label>
            <input
              ref={fileRef}
              id="kn-file"
              type="file"
              accept=".pdf,.docx,.txt,.csv,.md,.rtf"
              className="sr-only"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={useForAi} onChange={(e) => setUseForAi(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Use this to train the AI (reference for future builds)
          </label>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />} Upload to library
          </Button>
        </form>
      </section>

      {/* Coverage — what the AI has to learn from, and where the gaps are */}
      {coverage && coverage.total > 0 && (
        <section className="h-fit overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm lg:col-start-2">
          <div className="border-b border-slate-100 px-5 py-3.5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-950"><Sparkles className="h-4 w-4 text-pink-700" /> Learning coverage</h2>
          </div>
          <div className="space-y-3 p-5 text-sm">
            <div className="flex flex-wrap gap-2">
              {(["GOLD", "STANDARD", "RAW"] as Quality[]).map((q) => (
                <span key={q} className={`rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${QUALITY_STYLE[q]}`}>
                  {coverage.by_quality[q] ?? 0} {q.toLowerCase()}
                </span>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              {coverage.enriched}/{coverage.total} docs AI-enriched · embeddings {coverage.vectors_enabled ? "on" : "off"}
            </p>
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-600">GHL section coverage (gold / total)</p>
              <ul className="space-y-1">
                {coverage.sections.map((s) => (
                  <li key={s.key} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-slate-600">{s.label}</span>
                    <span className={`shrink-0 font-semibold ${s.thin ? "text-amber-600" : "text-slate-500"}`}>
                      {s.gold} / {s.any}{s.thin ? " · thin" : ""}
                    </span>
                  </li>
                ))}
              </ul>
              {coverage.sections.some((s) => s.thin) && (
                <p className="mt-2 text-[11px] text-amber-600">Upload gold exemplars for thin sections to improve generation.</p>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
