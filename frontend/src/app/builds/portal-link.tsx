"use client";
import * as React from "react";
import { Copy, ExternalLink, Check } from "lucide-react";

/** Shows the client portal link with a copy button + open-preview link.
 * The URL is computed client-side from the current origin so it matches
 * whatever host the staff member is on. */
export function PortalLink({ token }: { token: string }) {
  const [copied, setCopied] = React.useState(false);
  const [url] = React.useState(() =>
    typeof window === "undefined" ? `/portal/${token}` : `${window.location.origin}/portal/${token}`,
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the link is still visible to copy manually */
    }
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <code className="max-w-full truncate rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{url}</code>
      <button type="button" onClick={copy}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
        {copied ? <><Check className="h-3.5 w-3.5 text-emerald-600" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy link</>}
      </button>
      <a href={`/portal/${token}`} target="_blank" rel="noreferrer"
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
        <ExternalLink className="h-3.5 w-3.5" /> Preview
      </a>
    </div>
  );
}
