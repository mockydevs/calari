"use client";

import * as React from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast";
import { createBlueprintItem, updateBlueprintItem, deleteBlueprintItem } from "./blueprint-actions";
import { BLUEPRINT_SECTIONS, type BlueprintField } from "./_blueprint-config";

type Item = { id: number };
type StageOption = { value: string; label: string };
type SectionSpec = { resource: string; label: string; items: readonly Item[] };

const INPUT_CLS = "w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-pink-400 focus:outline-none";

function FieldInput({ field, value, stageOptions }: { field: BlueprintField; value: unknown; stageOptions: StageOption[] }) {
  if (field.input === "textarea")
    return <textarea name={field.name} defaultValue={(value as string) ?? ""} rows={2} className={INPUT_CLS} />;
  if (field.input === "number")
    return <input type="number" name={field.name} defaultValue={value == null ? 0 : Number(value)} className={INPUT_CLS} />;
  if (field.input === "bool")
    return (
      <select name={field.name} defaultValue={String(Boolean(value))} className={INPUT_CLS}>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  if (field.input === "stage")
    return (
      <select name={field.name} defaultValue={value == null ? "" : String(value)} className={INPUT_CLS}>
        <option value="">—</option>
        {stageOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  if (field.input === "select")
    return (
      <select name={field.name} defaultValue={(value as string) ?? field.options?.[0]?.value ?? ""} className={INPUT_CLS}>
        {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  return <input type="text" name={field.name} defaultValue={(value as string) ?? ""} className={INPUT_CLS} />;
}

function Fields({
  resource, buildId, item, stageOptions,
}: { resource: string; buildId: string; item?: Record<string, unknown>; stageOptions: StageOption[] }) {
  const section = BLUEPRINT_SECTIONS[resource];
  return (
    <div className="grid grid-cols-2 gap-2">
      <input type="hidden" name="__resource" value={resource} />
      <input type="hidden" name="__buildId" value={buildId} />
      {item && <input type="hidden" name="__id" value={String(item.id)} />}
      {section.fields.map((f) => (
        <label key={f.name} className={f.full ? "col-span-2 space-y-0.5" : "space-y-0.5"}>
          <span className="text-[11px] font-medium text-slate-500">{f.label}</span>
          <FieldInput field={f} value={item?.[f.name]} stageOptions={stageOptions} />
        </label>
      ))}
    </div>
  );
}

function Row({ resource, item, buildId, stageOptions }: { resource: string; item: Record<string, unknown>; buildId: string; stageOptions: StageOption[] }) {
  const section = BLUEPRINT_SECTIONS[resource];
  const toast = useToast();
  const [editing, setEditing] = React.useState(false);
  const [pending, start] = React.useTransition();
  const title = String(item[section.titleField] ?? "") || "(untitled)";

  function remove() {
    toast.confirm({
      title: `Delete ${section.singular}`,
      danger: true,
      confirmLabel: "Delete",
      message: `Remove "${title}"? This can't be undone.`,
      onConfirm: () =>
        start(async () => {
          try {
            const fd = new FormData();
            fd.set("__resource", resource);
            fd.set("__buildId", buildId);
            fd.set("__id", String(item.id));
            await deleteBlueprintItem(fd);
          } catch (e) {
            if (e instanceof Error && !e.message.includes("NEXT_REDIRECT")) toast.error(e.message, "Could not delete");
          }
        }),
    });
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5">
        <span className="truncate text-sm text-slate-700">{title}</span>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => setEditing(true)} aria-label="Edit"
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={remove} disabled={pending} aria-label="Delete"
            className="rounded p-1 text-red-500 hover:bg-red-50 disabled:opacity-50">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={updateBlueprintItem} onSubmit={() => setEditing(false)}
      className="rounded-md border border-pink-200 bg-pink-50/40 p-2.5">
      <Fields resource={resource} buildId={buildId} item={item} stageOptions={stageOptions} />
      <div className="mt-2 flex items-center gap-2">
        <Button type="submit" size="sm">Save</Button>
        <button type="button" onClick={() => setEditing(false)}
          className="rounded-md px-2 py-1 text-sm font-medium text-slate-500 hover:bg-slate-100">Cancel</button>
      </div>
    </form>
  );
}

function SectionEditor({ resource, items, buildId, stageOptions }: { resource: string; items: readonly Item[]; buildId: string; stageOptions: StageOption[] }) {
  const section = BLUEPRINT_SECTIONS[resource];
  const [adding, setAdding] = React.useState(false);
  return (
    <div className="space-y-1.5">
      {items.map((it) => (
        <Row key={it.id} resource={resource} item={it as Record<string, unknown>} buildId={buildId} stageOptions={stageOptions} />
      ))}
      {items.length === 0 && <p className="text-xs text-slate-400">Nothing here yet.</p>}
      {adding ? (
        <form action={createBlueprintItem} onSubmit={() => setAdding(false)}
          className="rounded-md border border-emerald-200 bg-emerald-50/40 p-2.5">
          <Fields resource={resource} buildId={buildId} stageOptions={stageOptions} />
          <div className="mt-2 flex items-center gap-2">
            <Button type="submit" size="sm" className="bg-emerald-600 hover:bg-emerald-700">Add</Button>
            <button type="button" onClick={() => setAdding(false)}
              className="rounded-md px-2 py-1 text-sm font-medium text-slate-500 hover:bg-slate-100">Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)}
          className="text-xs font-semibold text-pink-700 hover:text-pink-800">+ Add {section.singular}</button>
      )}
    </div>
  );
}

export function BlueprintEditor({ buildId, sections, stageOptions }: { buildId: string; sections: SectionSpec[]; stageOptions: StageOption[] }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        Correct anything the AI got wrong, then approve to hand the build to staff. Changes save immediately.
      </p>
      {sections.map((s) => (
        <details key={s.resource} className="rounded-md border border-slate-200 bg-slate-50/40">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-slate-700">
            {s.label} <span className="font-normal text-slate-400">({s.items.length})</span>
          </summary>
          <div className="border-t border-slate-100 p-3">
            <SectionEditor resource={s.resource} items={s.items} buildId={buildId} stageOptions={stageOptions} />
          </div>
        </details>
      ))}
    </div>
  );
}
