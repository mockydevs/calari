"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Bot, ShieldCheck } from "lucide-react";
import { api, ApiError } from "@/lib/portal/api";
import { useToast, Spinner } from "@/components/toast";

type BuildPoll = {
  memory_snapshots?: { id: number; summary: string }[];
  tasks?: { id: number; description?: string }[];
};

function qaCount(b: BuildPoll | null): number {
  return (b?.memory_snapshots ?? []).filter((s) => (s.summary || "").startsWith("AI QA:")).length;
}

/** Run an AI QA review of the build's brief vs its tasks (async + polling). */
export function RunQaButton({ buildId }: { buildId: number | string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);

  async function run() {
    setBusy(true);
    let baseline = 0;
    try {
      baseline = qaCount(await api.get<BuildPoll>(`builds/builds/${buildId}`).catch(() => null));
      await api.post(`builds/builds/${buildId}/brief-qa-check`, {});
      toast.info("Running QA review of the brief…", "Working…");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not start the QA check.");
      setBusy(false);
      return;
    }
    const deadline = Date.now() + 120_000;
    const poll = async () => {
      const b = await api.get<BuildPoll>(`builds/builds/${buildId}`).catch(() => null);
      if (qaCount(b) > baseline) {
        toast.success("QA review ready.", "Done");
        setBusy(false);
        router.refresh();
        return;
      }
      if (Date.now() > deadline) { setBusy(false); router.refresh(); return; }
      setTimeout(poll, 2500);
    };
    setTimeout(poll, 2500);
  }

  return (
    <button type="button" onClick={run} disabled={busy}
      className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60">
      {busy ? <><Spinner className="h-3.5 w-3.5" /> Reviewing…</> : <><ShieldCheck className="h-3.5 w-3.5" /> QA check</>}
    </button>
  );
}

/** Generate a step-by-step SOP for a build task (async + polling on description). */
export function GenerateSopButton({ buildId, taskId, hasDescription }: { buildId: number | string; taskId: number; hasDescription: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);

  async function run() {
    setBusy(true);
    try {
      await api.post(`builds/tasks/${taskId}/generate-sop`, {});
      toast.info("Generating the implementation steps…", "Working…");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not start SOP generation.");
      setBusy(false);
      return;
    }
    const deadline = Date.now() + 120_000;
    const poll = async () => {
      const b = await api.get<BuildPoll>(`builds/builds/${buildId}`).catch(() => null);
      const task = (b?.tasks ?? []).find((t) => t.id === taskId);
      if (task && (task.description || "").trim() && !hasDescription) {
        toast.success("SOP generated.", "Done");
        setBusy(false);
        router.refresh();
        return;
      }
      if (Date.now() > deadline) { setBusy(false); router.refresh(); return; }
      setTimeout(poll, 2500);
    };
    setTimeout(poll, 2500);
  }

  return (
    <button type="button" onClick={run} disabled={busy}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60">
      {busy ? <><Spinner className="h-3.5 w-3.5" /> …</> : <><Bot className="h-3.5 w-3.5" /> {hasDescription ? "Redo SOP" : "Generate SOP"}</>}
    </button>
  );
}
