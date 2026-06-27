"use client";
import * as React from "react";
import { Pencil, Trash2, X } from "lucide-react";
import { useToast, Spinner } from "@/components/toast";
import { updateContact, deleteContact, resolveBlocker, updateBlocker } from "./actions";

const iconBtn = "inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700";
const editInput = "h-8 w-full rounded-md border border-slate-200 px-2 text-sm outline-none focus:border-pink-400";

type Contact = { id: number; name: string; role?: string; email?: string; phone_number?: string };
type Blocker = { id: number; description: string };

/** A project contact: read-only row with inline edit + (admin) delete. */
export function ContactItem({ contact, projectId, isAdmin }: { contact: Contact; projectId: string; isAdmin: boolean }) {
  const toast = useToast();
  const [editing, setEditing] = React.useState(false);
  const [pending, start] = React.useTransition();

  function save(fd: FormData) {
    fd.set("id", String(contact.id));
    fd.set("projectId", projectId);
    start(async () => {
      try {
        await updateContact(fd);
        toast.success("Contact updated.");
        setEditing(false);
      } catch (e) {
        if (e instanceof Error && !e.message.includes("NEXT_REDIRECT")) toast.error(e.message);
      }
    });
  }

  if (editing) {
    return (
      <li className="py-2">
        <form action={save} className="grid gap-2 sm:grid-cols-2">
          <input name="name" required defaultValue={contact.name} placeholder="Name" className={editInput} />
          <input name="role" defaultValue={contact.role} placeholder="Role" className={editInput} />
          <input name="email" type="email" defaultValue={contact.email} placeholder="Email" className={editInput} />
          <input name="phone_number" defaultValue={contact.phone_number} placeholder="Phone" className={editInput} />
          <div className="flex items-center gap-2 sm:col-span-2">
            <button disabled={pending} className="inline-flex h-8 items-center gap-1 rounded-md bg-pink-700 px-2.5 text-xs font-semibold text-white hover:bg-pink-800 disabled:opacity-60">
              {pending && <Spinner className="h-3.5 w-3.5" />} Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"><X className="h-3.5 w-3.5" /> Cancel</button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-start justify-between gap-2 py-2 text-sm">
      <div>
        <span className="font-medium text-slate-800">{contact.name}</span>
        {contact.role && <span className="text-slate-500"> · {contact.role}</span>}
        <span className="block text-xs text-slate-400">{contact.email}{contact.phone_number ? ` · ${contact.phone_number}` : ""}</span>
      </div>
      <div className="flex shrink-0 items-center">
        <button type="button" onClick={() => setEditing(true)} className={iconBtn} aria-label="Edit contact"><Pencil className="h-3.5 w-3.5" /></button>
        {isAdmin && (
          <form action={deleteContact}>
            <input type="hidden" name="id" value={contact.id} />
            <input type="hidden" name="projectId" value={projectId} />
            <button className={iconBtn} aria-label="Delete contact"><Trash2 className="h-3.5 w-3.5" /></button>
          </form>
        )}
      </div>
    </li>
  );
}

/** A project blocker: read-only row with inline edit + resolve. */
export function BlockerItem({ blocker, projectId }: { blocker: Blocker; projectId: string }) {
  const toast = useToast();
  const [editing, setEditing] = React.useState(false);
  const [pending, start] = React.useTransition();

  function save(fd: FormData) {
    fd.set("id", String(blocker.id));
    fd.set("projectId", projectId);
    start(async () => {
      try {
        await updateBlocker(fd);
        toast.success("Blocker updated.");
        setEditing(false);
      } catch (e) {
        if (e instanceof Error && !e.message.includes("NEXT_REDIRECT")) toast.error(e.message);
      }
    });
  }

  if (editing) {
    return (
      <li className="rounded-md bg-red-50 p-2.5">
        <form action={save} className="flex items-center gap-2">
          <input name="description" required defaultValue={blocker.description} className={editInput} />
          <button disabled={pending} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-red-600 px-2.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60">
            {pending && <Spinner className="h-3.5 w-3.5" />} Save
          </button>
          <button type="button" onClick={() => setEditing(false)} className="shrink-0 rounded px-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100">Cancel</button>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-start justify-between gap-2 rounded-md bg-red-50 p-2.5 text-sm text-red-800">
      <span>{blocker.description}</span>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={() => setEditing(true)} className="rounded p-1 text-red-400 hover:bg-red-100 hover:text-red-700" aria-label="Edit blocker"><Pencil className="h-3.5 w-3.5" /></button>
        <form action={resolveBlocker}>
          <input type="hidden" name="id" value={blocker.id} />
          <input type="hidden" name="projectId" value={projectId} />
          <button className="rounded px-1.5 text-xs font-semibold text-red-700 hover:bg-red-100" aria-label="Resolve blocker">Resolve</button>
        </form>
      </div>
    </li>
  );
}
