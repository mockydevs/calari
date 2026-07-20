"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { api, ApiError } from "@/lib/portal/api";
import { useToast, Spinner } from "@/components/toast";
import { createTask } from "../builds/actions";
import type { DjangoClient, DjangoUser } from "../builds/_shared";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

type ClientBuild = { id: number; title: string };

/**
 * The fast path for logging a client's change request: pick the client, paste
 * what they asked for, pick who's fixing it — no need to go find their build
 * first. Behind the scenes this still creates a `builds.Task` on that client's
 * build; when a client has exactly one build (the common case) that's resolved
 * automatically, and a build picker only appears if they have more than one.
 */
export function QuickTaskForm({ clients, users }: { clients: DjangoClient[]; users: DjangoUser[] }) {
  const router = useRouter();
  const toast = useToast();
  const [clientId, setClientId] = React.useState("");
  const [builds, setBuilds] = React.useState<ClientBuild[]>([]);
  const [buildId, setBuildId] = React.useState("");
  const [loadingBuilds, setLoadingBuilds] = React.useState(false);
  const [description, setDescription] = React.useState("");
  const [assigneeId, setAssigneeId] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function onClientChange(id: string) {
    setClientId(id);
    setBuildId("");
    setBuilds([]);
    if (!id) return;
    setLoadingBuilds(true);
    try {
      const data = await api.get<ClientBuild[] | { results: ClientBuild[] }>("builds/builds", { client: id });
      const list = Array.isArray(data) ? data : data.results ?? [];
      setBuilds(list);
      if (list.length === 1) setBuildId(String(list[0].id));
    } catch {
      toast.error("Could not load this client's builds.");
    } finally {
      setLoadingBuilds(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!buildId || !description.trim()) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.set("buildId", buildId);
      fd.set("title", description.trim().slice(0, 80));
      fd.set("type", "OTHER");
      fd.set("description", description.trim());
      fd.set("assignee", assigneeId);
      await createTask(fd);
      toast.success("Task created and assigned.");
      setClientId("");
      setBuilds([]);
      setBuildId("");
      setDescription("");
      setAssigneeId("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create the task.");
    } finally {
      setSubmitting(false);
    }
  }

  const selectedClientHasNoBuilds = clientId && !loadingBuilds && builds.length === 0;

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-900/[0.03]">
      <p className="text-sm font-semibold text-slate-950">Log a client request</p>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Client</label>
          <Select value={clientId} onChange={(e) => onClientChange(e.target.value)} className="h-9 w-full">
            <option value="">Select client…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>

        {builds.length > 1 && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Which build?</label>
            <Select value={buildId} onChange={(e) => setBuildId(e.target.value)} className="h-9 w-full">
              <option value="">Select build…</option>
              {builds.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </Select>
          </div>
        )}
      </div>

      {selectedClientHasNoBuilds && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
          This client has no builds yet.{" "}
          <Link href="/builds/new" className="font-semibold underline underline-offset-2 hover:no-underline">Create one first</Link>.
        </p>
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">What did they ask for?</label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Paste the client's request…"
          required
        />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-[220px]">
          <label className="mb-1 block text-xs font-medium text-slate-500">Assign to</label>
          <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="h-9 w-full">
            <option value="">Unassigned (build owner)</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
          </Select>
        </div>
        <Button type="submit" disabled={submitting || !buildId || !description.trim()}>
          {submitting ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />} Create task
        </Button>
      </div>
    </form>
  );
}
