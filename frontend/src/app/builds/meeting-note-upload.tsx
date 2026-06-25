"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { api, ApiError } from "@/lib/portal/api";
import { useToast, Spinner } from "@/components/toast";

const ACCEPT = ".pdf,.docx,.txt,.csv,.md,.rtf";

/** Upload a document (PDF/DOCX/TXT/…) as a meeting note; the backend extracts its text. */
export function MeetingNoteUpload({ buildId }: { buildId: number | string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("build", String(buildId));
      fd.set("file", file);
      await api.upload("builds/meeting-notes/upload", fd);
      toast.success(`Imported notes from “${file.name}”.`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not read that file.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={onChange} disabled={busy} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
      >
        {busy ? <><Spinner className="h-3.5 w-3.5" /> Reading…</> : <><Upload className="h-3.5 w-3.5" /> Upload file</>}
      </button>
    </>
  );
}
