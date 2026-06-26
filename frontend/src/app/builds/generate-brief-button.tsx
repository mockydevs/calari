"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Bot } from "lucide-react";
import { api, ApiError } from "@/lib/portal/api";
import { useToast, Spinner } from "@/components/toast";

type Note = { id: number; ai_status?: string };

export function GenerateBriefButton({ buildId, hasBrief, label }: { buildId: number | string; hasBrief: boolean; label?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);

  async function run() {
    setBusy(true);
    try {
      await api.post(`builds/builds/${buildId}/generate-brief`, {});
      toast.info("Capturing the full vision blueprint — this can take up to a minute.", "Working…");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not start generation.");
      setBusy(false);
      return;
    }

    // Poll the latest meeting note's ai_status (processing → done | failed).
    const deadline = Date.now() + 120_000;
    const poll = async () => {
      const res = await api.get<Note[] | { results: Note[] }>(`builds/meeting-notes?build=${buildId}`).catch(() => null);
      const list = Array.isArray(res) ? res : res?.results ?? [];
      const latest = [...list].sort((a, b) => b.id - a.id)[0];
      const status = latest?.ai_status;
      if (status === "done") {
        toast.success("Vision blueprint captured.", "Done");
        setBusy(false);
        router.refresh();
        return;
      }
      if (status === "failed") {
        toast.error("Generation failed — check your AI key under Settings → AI Keys and try again.", "Blueprint failed");
        setBusy(false);
        return;
      }
      if (Date.now() > deadline) {
        toast.info("Still working in the background — refresh in a moment.");
        setBusy(false);
        router.refresh();
        return;
      }
      setTimeout(poll, 2500);
    };
    setTimeout(poll, 2500);
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className="inline-flex h-8 items-center gap-2 rounded-md bg-gradient-to-r from-pink-600 to-fuchsia-600 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:from-pink-700 hover:to-fuchsia-700 disabled:opacity-60"
    >
      {busy ? <><Spinner className="h-3.5 w-3.5" /> Generating…</> : <><Bot className="h-3.5 w-3.5" /> {label ?? (hasBrief ? "Regenerate blueprint" : "Generate blueprint")}</>}
    </button>
  );
}
