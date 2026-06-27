"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, FileText, Plus, Upload, X } from "lucide-react";
import { api, ApiError } from "@/lib/portal/api";
import { useToast, Spinner } from "@/components/toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const ACCEPT = ".pdf,.docx,.txt,.csv,.md,.rtf";

type DjangoClient = { id: number; name: string };

export function NewBuildForm({ clients }: { clients: DjangoClient[] }) {
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = React.useState("");
  const [client, setClient] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (list) setFiles((prev) => [...prev, ...Array.from(list)]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return toast.error("Build title is required.");
    if (!client) return toast.error("Select a client.");
    setBusy(true);
    try {
      const build = await api.post<{ id: number }>("builds/builds", {
        title: title.trim(), client: Number(client), status: "DRAFT",
      });
      if (notes.trim()) {
        await api.post("builds/meeting-notes", { build: build.id, raw_text: notes.trim(), source: "paste" });
      }
      for (const f of files) {
        const fd = new FormData();
        fd.set("build", String(build.id));
        fd.set("file", f);
        await api.upload("builds/meeting-notes/upload", fd);
      }
      toast.success("Build created.");
      router.push(`/builds/${build.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create the build.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid items-start gap-5 lg:grid-cols-5">
      {/* Left: the essentials */}
      <section className="space-y-5 lg:col-span-2">
        <div className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]">
          <div className="flex items-center gap-2 border-b border-pink-100 bg-pink-50/55 px-5 py-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-pink-700 ring-1 ring-pink-100"><ClipboardList className="h-4 w-4" /></span>
            <h2 className="text-sm font-semibold text-slate-950">Build details</h2>
          </div>
          <div className="space-y-4 p-5">
            <div className="space-y-1.5">
              <Label htmlFor="title">Build title</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Acme — lead intake automation" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client">Client</Label>
              <Select id="client" value={client} onChange={(e) => setClient(e.target.value)} required>
                <option value="" disabled>Select a client</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
          </div>
        </div>

        <Button type="submit" disabled={busy} className="h-11 w-full">
          {busy ? <><Spinner className="h-4 w-4" /> Creating…</> : <><Plus className="h-4 w-4" /> Create build</>}
        </Button>
        <p className="text-center text-xs text-slate-500">Notes are optional now — you can add them later and generate the brief from the build.</p>
      </section>

      {/* Right: meeting notes (paste + upload) — the wide column */}
      <section className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03] lg:col-span-3">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-700"><FileText className="h-4 w-4" /></span>
          <h2 className="text-sm font-semibold text-slate-950">Client meeting notes</h2>
        </div>
        <div className="grid gap-4 p-5 lg:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="notes">Paste notes</Label>
            <Textarea
              id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={14}
              className="min-h-[320px] resize-y font-mono text-xs leading-5"
              placeholder="Paste the client call notes here…"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Or upload documents</Label>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
              onClick={() => inputRef.current?.click()}
              className={`flex min-h-[320px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${dragging ? "border-pink-400 bg-pink-50/60" : "border-slate-300 bg-slate-50/40 hover:border-pink-300 hover:bg-pink-50/30"}`}
            >
              <input ref={inputRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => { addFiles(e.target.files); if (inputRef.current) inputRef.current.value = ""; }} />
              {files.length === 0 ? (
                <>
                  <Upload className="h-7 w-7 text-slate-400" />
                  <p className="mt-2 text-sm font-medium text-slate-700">Drag &amp; drop or click to upload</p>
                  <p className="mt-1 text-xs text-slate-500">PDF, DOCX, TXT, CSV, MD, RTF — text is extracted automatically</p>
                </>
              ) : (
                <ul className="w-full space-y-1.5" onClick={(e) => e.stopPropagation()}>
                  {files.map((f, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-left text-xs">
                      <span className="flex min-w-0 items-center gap-1.5"><FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate text-slate-700">{f.name}</span></span>
                      <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
                    </li>
                  ))}
                  <li className="pt-1 text-center text-xs font-medium text-pink-700">+ add more</li>
                </ul>
              )}
            </div>
          </div>
        </div>
      </section>
    </form>
  );
}
