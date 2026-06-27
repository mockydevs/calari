"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Bot, Check, Copy, Download, RefreshCw } from "lucide-react";
import { api, ApiError } from "@/lib/portal/api";
import { useToast, Spinner } from "@/components/toast";
import { ClientHandoverButton } from "./handover-button";
import { type MeetingNote } from "./_shared";

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "build";
}

function fmt(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

/**
 * The implementation build document — the centerpiece of the Implementation tab.
 * It's persisted on the build, so it's ALWAYS shown (no View/Hide toggle) and survives
 * navigation; the AI only re-runs when a human clicks Regenerate.
 */
export function BuilderDocPanel({
  buildId, title, initialMarkdown, generatedAt, notes,
}: {
  buildId: string;
  title: string;
  initialMarkdown: string;
  generatedAt?: string | null;
  notes: MeetingNote[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [markdown, setMarkdown] = React.useState(initialMarkdown || "");
  const [genAt, setGenAt] = React.useState<string | null>(generatedAt ?? null);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  async function generate() {
    setBusy(true);
    try {
      const res = await api.post<{ markdown: string; generated_at: string }>(`builds/builds/${buildId}/build-document`, {});
      setMarkdown(res.markdown || "");
      setGenAt(res.generated_at ?? new Date().toISOString());
      toast.success("Build document generated.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not generate the build document.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!markdown) return;
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    toast.success("Build document copied.");
    setTimeout(() => setCopied(false), 2000);
  }

  function download() {
    if (!markdown) return;
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(title)}-builder-doc.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* Main: the build document */}
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-slate-500">
            {genAt ? <>Generated {fmt(genAt)}</> : "Not generated yet"}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {markdown && (
              <>
                <button type="button" onClick={copy} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  {copied ? <><Check className="h-3.5 w-3.5 text-emerald-600" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                </button>
                <button type="button" onClick={download} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  <Download className="h-3.5 w-3.5" /> .md
                </button>
                <ClientHandoverButton buildId={buildId} title={title} />
              </>
            )}
            <button
              type="button"
              onClick={generate}
              disabled={busy}
              className="inline-flex h-8 items-center gap-2 rounded-md bg-gradient-to-r from-pink-600 to-fuchsia-600 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:from-pink-700 hover:to-fuchsia-700 disabled:opacity-60"
            >
              {busy ? <><Spinner className="h-3.5 w-3.5" /> Generating…</> : <><RefreshCw className="h-3.5 w-3.5" /> {markdown ? "Regenerate" : "Generate"}</>}
            </button>
          </div>
        </div>

        {markdown ? (
          <pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs leading-relaxed text-slate-700">{markdown}</pre>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-6 py-12 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-pink-50 text-pink-700 ring-1 ring-pink-100"><Bot className="h-5 w-5" /></span>
            <p className="mt-3 text-sm font-semibold text-slate-800">No build document yet</p>
            <p className="mt-1 max-w-md text-xs text-slate-500">
              Generate the step-by-step GHL implementation document from the meeting notes and tasklist.
              It&apos;s saved to the build, so it stays here until you regenerate it.
            </p>
            <button type="button" onClick={generate} disabled={busy} className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-gradient-to-r from-pink-600 to-fuchsia-600 px-4 text-xs font-semibold text-white shadow-sm hover:from-pink-700 hover:to-fuchsia-700 disabled:opacity-60">
              {busy ? <><Spinner className="h-3.5 w-3.5" /> Generating…</> : <><Bot className="h-3.5 w-3.5" /> Generate build document</>}
            </button>
          </div>
        )}
      </div>

      {/* Side: original meeting notes */}
      <aside className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-950">Original meeting notes</p>
        <p className="mt-1 text-xs text-slate-500">Verify the build document against the raw client context.</p>
        <div className="mt-3 max-h-[36rem] space-y-2 overflow-auto pr-1">
          {notes.length === 0 ? (
            <p className="text-xs text-slate-400">No meeting notes yet.</p>
          ) : (
            notes.map((n) => (
              <details key={n.id} className="rounded-md border border-slate-200 bg-slate-50 p-2" open={notes.length === 1}>
                <summary className="cursor-pointer text-xs font-semibold text-slate-700">{n.title || "Meeting notes"}</summary>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">{n.raw_text}</p>
              </details>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
