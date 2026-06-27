"use client";
import * as React from "react";
import { Check, Mail, Pencil, Trash2, X } from "lucide-react";
import { updateClient, deleteClient } from "./actions";

export type ClientItem = {
  id: number;
  name: string;
  company_name: string;
  email: string;
  phone_number: string;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function ClientRow({ client }: { client: ClientItem }) {
  const [editing, setEditing] = React.useState(false);

  if (editing) {
    return (
      <form
        action={updateClient}
        onSubmit={() => setEditing(false)}
        className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-center"
      >
        <input type="hidden" name="id" value={client.id} />
        <input name="name" defaultValue={client.name} required placeholder="Name" className="h-9 rounded-md border border-slate-300 px-2.5 text-sm focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500" />
        <input name="company" defaultValue={client.company_name} placeholder="Company" className="h-9 rounded-md border border-slate-300 px-2.5 text-sm focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500" />
        <input name="email" type="email" defaultValue={client.email} placeholder="Email" className="h-9 rounded-md border border-slate-300 px-2.5 text-sm focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500" />
        <div className="flex items-center gap-1.5">
          <input type="hidden" name="phone" value={client.phone_number} />
          <button type="submit" className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-pink-600 text-white hover:bg-pink-700" aria-label="Save"><Check className="h-4 w-4" /></button>
          <button type="button" onClick={() => setEditing(false)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100" aria-label="Cancel"><X className="h-4 w-4" /></button>
        </div>
      </form>
    );
  }

  return (
    <div className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-pink-50/40">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 to-fuchsia-600 text-xs font-bold text-white shadow-sm">
        {initials(client.name)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-semibold text-slate-900">{client.name}</span>
          {client.company_name && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{client.company_name}</span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
          <Mail className="h-3 w-3 shrink-0" />
          {client.email ? (
            <a href={`mailto:${client.email}`} className="truncate hover:text-pink-700">{client.email}</a>
          ) : (
            <span className="text-slate-400">No email</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100">
        <button onClick={() => setEditing(true)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-pink-50 hover:text-pink-700" aria-label="Edit"><Pencil className="h-4 w-4" /></button>
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
