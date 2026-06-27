"use client";
import * as React from "react";
import { Check, Copy, Download, FileDown } from "lucide-react";
import { api, ApiError } from "@/lib/portal/api";
import { useToast, Spinner } from "@/components/toast";

/** Fetch an AI-generated markdown document for a build and preview/copy/download it. */
function MarkdownDocButton({
  buildId, title, endpoint, label, hideLabel, previewTitle, slugSuffix, fallback, copiedMsg, accent,
}: {
  buildId: number | string;
  title: string;
  endpoint: string;
  label: string;
  hideLabel: string;
  previewTitle: string;
  slugSuffix: string;
  fallback: string;
  copiedMsg: string;
  accent?: boolean;
}) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const [markdown, setMarkdown] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  async function load() {
    if (markdown !== null) { setMarkdown(null); return; }
    setBusy(true);
    try {
      const res = await api.post<{ markdown: string }>(`builds/builds/${buildId}/${endpoint}`, {});
      setMarkdown(res.markdown || `_${fallback}_`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load the document.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!markdown) return;
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    toast.success(copiedMsg);
    setTimeout(() => setCopied(false), 2000);
  }

  function download() {
    if (!markdown) return;
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "build";
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}-${slugSuffix}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const btnClass = accent
    ? "border-pink-200 bg-pink-50 text-pink-700 hover:bg-pink-100"
    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50";

  return (
    <>
      <button
        type="button"
        onClick={load}
        disabled={busy}
        className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-semibold transition-colors disabled:opacity-60 ${btnClass}`}
      >
        {busy ? <><Spinner className="h-3.5 w-3.5" /> Generating…</> : <><FileDown className="h-3.5 w-3.5" /> {markdown !== null ? hideLabel : label}</>}
      </button>

      {markdown !== null && (
        <div className="mt-3 w-full rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{previewTitle}</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={copy} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                {copied ? <><Check className="h-3.5 w-3.5 text-emerald-600" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
              </button>
              <button type="button" onClick={download} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                <Download className="h-3.5 w-3.5" /> .md
              </button>
            </div>
          </div>
          <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap px-4 py-3 text-xs leading-relaxed text-slate-700">{markdown}</pre>
        </div>
      )}
    </>
  );
}

/** AI-generated, implementer-facing GHL build document. */
export function BuildDocumentButton({ buildId, title }: { buildId: number | string; title: string }) {
  return (
    <MarkdownDocButton
      buildId={buildId} title={title} endpoint="build-document" accent
      label="Builder doc" hideLabel="Hide builder doc"
      previewTitle="Implementation build document" slugSuffix="builder-doc"
      fallback="The build document could not be generated yet." copiedMsg="Builder document copied."
    />
  );
}

/** AI-generated, client-facing handover document (end of build). */
export function ClientHandoverButton({ buildId, title }: { buildId: number | string; title: string }) {
  return (
    <MarkdownDocButton
      buildId={buildId} title={title} endpoint="client-handover"
      label="Client handover" hideLabel="Hide handover"
      previewTitle="Client handover document" slugSuffix="client-handover"
      fallback="The client handover could not be generated yet." copiedMsg="Client handover copied."
    />
  );
}
