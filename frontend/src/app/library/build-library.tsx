"use client";

import * as React from "react";
import { Upload, Trash2, FileText, Sparkles } from "lucide-react";
import { api, ApiError } from "@/lib/portal/api";
import { useToast, Spinner } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";

type Doc = {
  id: number; title: string; client_name: string | null; filename: string;
  file_url: string; use_for_ai: boolean; uploaded_by_name: string | null;
  created_at: string; text_chars: number;
};
type ClientOpt = { id: number; name: string };

export function BuildLibrary({ clients }: { clients: ClientOpt[] }) {
  const toast = useToast();
  const [docs, setDocs] = React.useState<Doc[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [clientId, setClientId] = React.useState("");
  const [useForAi, setUseForAi] = React.useState(true);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = React.useState("");
  const [dragOver, setDragOver] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await api.get<Doc[] | { results: Doc[] }>("builds/knowledge");
      setDocs(Array.isArray(res) ? res : res.results ?? []);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not load the library.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

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
      fd.set("use_for_ai", String(useForAi));
      await api.upload("builds/knowledge/upload", fd);
      toast.success("Document added to the Build Library.");
      setTitle(""); setClientId("");
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
                      {d.use_for_ai && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-pink-50 px-2 py-0.5 text-[10px] font-semibold text-pink-700 ring-1 ring-pink-100">
                          <Sparkles className="h-3 w-3" /> AI learning
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {d.client_name ? `${d.client_name} · ` : ""}{(d.text_chars / 1000).toFixed(1)}k chars · {d.uploaded_by_name || "—"} · {formatDate(d.created_at)}
                    </p>
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
    </div>
  );
}
