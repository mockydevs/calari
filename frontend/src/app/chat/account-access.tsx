"use client";

import { useRef, useState } from "react";
import { Loader2, Settings2, X } from "lucide-react";
import { api } from "@/lib/portal/api";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast";
import type { ChatAccount, ChatAccounts, ChatGrant } from "./types";

const selectStyle = "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-pink-600/20";

export function AccountAccess({ data, account, onRefresh }: { data: ChatAccounts; account?: ChatAccount; onRefresh: (accountId?: number) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const toast = useToast();
  const [grants, setGrants] = useState<ChatGrant[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function loadGrants() {
    if (!account) return;
    setLoading(true);
    setError("");
    try { setGrants((await api.get<{ grants: ChatGrant[] }>(`ghl-chat/accounts/${account.id}/grants/`)).grants); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not load account grants."); }
    finally { setLoading(false); }
  }

  async function enableAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const clientId = Number(new FormData(form).get("client_id"));
    if (!clientId || busy) return;
    setBusy(true);
    try {
      const enabled = await api.post<ChatAccount>("ghl-chat/accounts/", { client_id: clientId });
      await onRefresh(enabled.id);
      dialog.current?.close();
      toast.success("The GHL account is enabled for chat. Grant staff access when needed.");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not enable account."); }
    finally { setBusy(false); }
  }

  async function saveGrant(userId: number, canExecute: boolean, revoke = false) {
    if (!account || busy) return;
    setBusy(true);
    try {
      await api.post(`ghl-chat/accounts/${account.id}/grants/`, { user_id: userId, can_execute: canExecute, revoke });
      await loadGrants();
      toast.success(revoke ? "Account access revoked." : "Account access updated.");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not update access."); }
    finally { setBusy(false); }
  }

  return <>
    <Button size="sm" variant="outline" onClick={() => { dialog.current?.showModal(); void loadGrants(); }}><Settings2 className="h-3.5 w-3.5" />Account access</Button>
    <dialog ref={dialog} aria-labelledby="chat-access-title" className="fixed inset-0 m-auto max-h-[85dvh] w-[min(600px,calc(100%_-_2rem))] overflow-auto rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-950/50" onCancel={(event) => { if (busy) event.preventDefault(); }}>
      <div className="flex items-center justify-between border-b border-slate-100 p-5"><h2 id="chat-access-title" className="font-semibold">GHL chat access</h2><button aria-label="Close account access" disabled={busy} onClick={() => dialog.current?.close()} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
      <div className="space-y-6 p-5">
        <form onSubmit={(event) => void enableAccount(event)} className="space-y-3">
          <label htmlFor="chat-enable-client" className="block text-sm font-semibold">Enable a connected account</label>
          <p className="text-xs leading-5 text-slate-500">Uses the token already saved under Clients. Credentials are never shown in chat.</p>
          <select id="chat-enable-client" name="client_id" required defaultValue="" className={selectStyle} disabled={busy}>
            <option value="" disabled>Select a connected client</option>
            {(data.connections ?? []).filter((connection) => !data.accounts.some((item) => item.location_id === connection.location_id)).map((connection) => <option key={connection.client_id} value={connection.client_id}>{connection.name}</option>)}
          </select>
          <Button size="sm" type="submit" disabled={busy}>Enable for chat</Button>
        </form>
        {account ? <section className="space-y-4 border-t border-slate-200 pt-5">
          <div><h3 className="text-sm font-semibold">Staff access · {account.name}</h3><p className="mt-1 text-xs leading-5 text-slate-500">Administrators already have access. Other staff need an explicit grant. Allowing changes still requires confirmation for each operation.</p></div>
          {loading ? <p role="status" className="text-xs text-slate-500">Loading grants…</p> : error ? <p role="alert" className="text-xs text-red-700">{error}</p> : <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">{grants.length ? grants.map((grant) => <li key={grant.user_id} className="flex items-center gap-3 p-3 text-xs"><div className="min-w-0 flex-1"><p className="font-semibold">{grant.name}</p><p className="mt-1 text-slate-500">{grant.can_execute ? "Read + confirmed changes" : "Read only"}</p></div><Button size="sm" variant="ghost" disabled={busy} aria-label={`Revoke access for ${grant.name}`} onClick={() => toast.confirm({ title: `Revoke ${grant.name}'s access?`, message: `They will no longer be able to query, export or act on ${account.name}.`, danger: true, confirmLabel: "Revoke access", onConfirm: () => void saveGrant(grant.user_id, false, true) })}>Revoke</Button></li>) : <li className="p-3 text-xs text-slate-500">No staff grants. Only administrators have access.</li>}</ul>}
          <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void saveGrant(Number(form.get("user_id")), form.get("can_execute") === "on"); }}>
            <label htmlFor="chat-grant-staff" className="block text-xs font-semibold">Add or update a staff grant</label>
            <select id="chat-grant-staff" name="user_id" required defaultValue="" className={selectStyle} disabled={busy}><option value="" disabled>Select a staff member</option>{(data.staff ?? []).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select>
            <label className="flex items-start gap-2 text-xs leading-5 text-slate-600"><input type="checkbox" name="can_execute" className="mt-1 accent-pink-700" disabled={busy} />Allow confirmed changes, including deletes, payments and outbound messages permitted by the GHL token.</label>
            <Button size="sm" type="submit" disabled={busy || loading}>{busy && <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />}Save access</Button>
          </form>
        </section> : <p className="text-xs text-slate-500">Select an account in the chat workspace to manage its staff access.</p>}
      </div>
    </dialog>
  </>;
}
