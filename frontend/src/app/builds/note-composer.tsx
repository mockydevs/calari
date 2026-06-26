"use client";

import * as React from "react";
import { Plus, Sparkles } from "lucide-react";
import { useToast, Spinner } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { addMeetingNote, logProgressUpdate } from "./actions";

const TYPES = [
  { value: "meeting", label: "Meeting notes (feeds the blueprint)" },
  { value: "progress", label: "Progress update (captures changes)" },
  { value: "change_request", label: "Client-requested change" },
];

/**
 * One composer for every kind of meeting note. "Meeting notes" feed the full
 * blueprint (re)generation; "Progress update" / "Client-requested change" run the
 * delta flow — capturing scope changes, questions, and progress without rewriting
 * the blueprint.
 */
export function NoteComposer({ buildId }: { buildId: string }) {
  const toast = useToast();
  const [type, setType] = React.useState("meeting");
  const [text, setText] = React.useState("");
  const [pending, start] = React.useTransition();
  const isDelta = type !== "meeting";

  function submit() {
    if (!text.trim()) { toast.error("Add some notes first."); return; }
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("buildId", buildId);
        fd.set("rawText", text.trim());
        fd.set("kind", type);
        if (isDelta) {
          await logProgressUpdate(fd);
          toast.success("Logged — change requests, questions & progress captured.");
        } else {
          await addMeetingNote(fd);
          toast.success("Meeting notes added. Generate / Regenerate to build them in.");
        }
        setText("");
      } catch (e) {
        if (e instanceof Error && !e.message.includes("NEXT_REDIRECT")) toast.error(e.message);
      }
    });
  }

  return (
    <div className="mt-3 space-y-2">
      <Select value={type} onChange={(e) => setType(e.target.value)} className="h-9 w-auto">
        {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </Select>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={isDelta ? "What changed / progress since last meeting…" : "Paste or type meeting notes…"}
      />
      <div className="flex items-center gap-2">
        <Button type="button" onClick={submit} size="sm" disabled={pending}>
          {pending ? <Spinner className="h-3.5 w-3.5" /> : isDelta ? <Sparkles className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {isDelta ? "Log update" : "Add note"}
        </Button>
      </div>
      <p className="text-[11px] text-slate-400">
        {isDelta
          ? "Captures scope changes (→ change requests), new questions (→ gaps) and progress, and refreshes the build memory — without rewriting the blueprint."
          : "Meeting notes feed the full blueprint when you Generate / Regenerate."}
      </p>
    </div>
  );
}
