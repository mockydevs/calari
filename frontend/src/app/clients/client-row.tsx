"use client";
import * as React from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { updateClient, deleteClient } from "./actions";

export type ClientItem = {
  id: number;
  name: string;
  company_name: string;
  email: string;
  phone_number: string;
};

export function ClientRow({ client }: { client: ClientItem }) {
  const [editing, setEditing] = React.useState(false);

  if (editing) {
    return (
      <form
        action={updateClient}
        onSubmit={() => setEditing(false)}
        className="grid gap-2 px-5 py-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-center"
      >
        <input type="hidden" name="id" value={client.id} />
        <input name="name" defaultValue={client.name} required placeholder="Name" className="h-9 rounded-md border border-slate-300 px-2.5 text-sm" />
        <input name="company" defaultValue={client.company_name} placeholder="Company" className="h-9 rounded-md border border-slate-300 px-2.5 text-sm" />
        <input name="email" type="email" defaultValue={client.email} placeholder="Email" className="h-9 rounded-md border border-slate-300 px-2.5 text-sm" />
        <div className="flex items-center gap-1.5">
          <input type="hidden" name="phone" value={client.phone_number} />
          <button type="submit" className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-cyan-600 text-white hover:bg-cyan-700" aria-label="Save"><Check className="h-4 w-4" /></button>
          <button type="button" onClick={() => setEditing(false)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100" aria-label="Cancel"><X className="h-4 w-4" /></button>
        </div>
      </form>
    );
  }

  return (
    <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2 px-5 py-3.5 transition-colors hover:bg-cyan-50/30">
      <span className="font-semibold text-slate-950">{client.name}</span>
      <span className="text-slate-600">{client.company_name || "—"}</span>
      <span className="text-slate-600">{client.email || "—"}</span>
      <div className="flex items-center gap-1.5">
        <button onClick={() => setEditing(true)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-cyan-50 hover:text-cyan-700" aria-label="Edit"><Pencil className="h-4 w-4" /></button>
        <form action={deleteClient}>
          <input type="hidden" name="id" value={client.id} />
          <button
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
            aria-label={`Delete ${client.name}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
