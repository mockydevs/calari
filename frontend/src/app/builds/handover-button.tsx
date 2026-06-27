"use client";
import * as React from "react";
import { Check, Copy, Download, FileDown } from "lucide-react";
import { api, ApiError } from "@/lib/portal/api";
import { useToast, Spinner } from "@/components/toast";

/** Fetch the rendered client-handover markdown for a build and preview/copy/download it. */
export function HandoverButton({ buildId, title }: { buildId: number | string; title: string }) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const [markdown, setMarkdown] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  async function load() {
    if (markdown !== null) {
      setMarkdown(null); // toggle closed
      return;
    }
    setBusy(true);
    try {
      const res = await api.get<{ markdown: string }>(`builds/builds/${buildId}/handover`);
      setMarkdown(res.markdown || "_Nothing captured yet._");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load the handover.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!markdown) return;
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    toast.success("Handover markdown copied.");
    setTimeout(() => setCopied(false), 2000);
  }

  function download() {
    if (!markdown) return;
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "handover";
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}-handover.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <button
        type="button"
        onClick={load}
        disabled={busy}
        className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
      >
        {busy ? <><Spinner className="h-3.5 w-3.5" /> Loading…</> : <><FileDown className="h-3.5 w-3.5" /> {markdown !== null ? "Hide handover" : "View handover"}</>}
      </button>

      {markdown !== null && (
        <div className="mt-3 w-full rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Handover preview</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={copy} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                {copied ? <><Check className="h-3.5 w-3.5 text-emerald-600" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
              </button>
              <button type="button" onClick={download} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                <Download className="h-3.5 w-3.5" /> .md
              </button>
            </div>
          </div>
          <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap px-4 py-3 text-xs leading-relaxed text-slate-700">{markdown}</pre>
        </div>
      )}
    </>
  );
}

/** Fetch the AI-generated, implementer-facing GHL build document. */
export function BuildDocumentButton({ buildId, title }: { buildId: number | string; title: string }) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const [markdown, setMarkdown] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  async function load() {
    if (markdown !== null) {
      setMarkdown(null);
      return;
    }
    setBusy(true);
    try {
      const res = await api.get<{ markdown: string }>(`builds/builds/${buildId}/build-document`);
      setMarkdown(res.markdown || "_The build document could not be generated yet._");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load the build document.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!markdown) return;
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    toast.success("Builder document copied.");
    setTimeout(() => setCopied(false), 2000);
  }

  function download() {
    if (!markdown) return;
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "build";
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}-builder-doc.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <button
        type="button"
        onClick={load}
        disabled={busy}
        className="inline-flex h-8 items-center gap-2 rounded-md border border-pink-200 bg-pink-50 px-3 text-xs font-semibold text-pink-700 transition-colors hover:bg-pink-100 disabled:opacity-60"
      >
        {busy ? <><Spinner className="h-3.5 w-3.5" /> Generating…</> : <><FileDown className="h-3.5 w-3.5" /> {markdown !== null ? "Hide builder doc" : "Builder doc"}</>}
      </button>

      {markdown !== null && (
        <div className="mt-3 w-full rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Implementation build document</span>
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
