"use client";
import * as React from "react";

/** Public client feedback form — posts through the BFF proxy to the AllowAny
 * Django endpoint (builds/portal/<token>/feedback). No auth required. */
export function FeedbackForm({ token }: { token: string }) {
  const [state, setState] = React.useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = React.useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    const message = String(fd.get("message") ?? "").trim();
    if (!message) { setError("Please add a message."); return; }
    setState("sending"); setError("");
    try {
      const res = await fetch(`/api/portal/builds/portal/${encodeURIComponent(token)}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, message }),
      });
      if (!res.ok) throw new Error("Could not send your feedback. Please try again.");
      setState("sent");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  if (state === "sent") {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        Thanks — your feedback has been sent to the Calari team.
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input
        name="name"
        placeholder="Your name (optional)"
        className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-pink-400"
      />
      <textarea
        name="message"
        rows={4}
        required
        placeholder="Share feedback or questions with the team…"
        className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-pink-400"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={state === "sending"}
        className="inline-flex h-10 items-center rounded-md bg-gradient-to-r from-pink-600 to-fuchsia-600 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:from-pink-700 hover:to-fuchsia-700 disabled:opacity-60"
      >
        {state === "sending" ? "Sending…" : "Send feedback"}
      </button>
    </form>
  );
}
