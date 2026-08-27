import Link from "next/link";
import { requireAdmin } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import { GhlConnectionForm, type GhlStatus } from "./connection-form";
import { ContextPolicy } from "./context-policy";

export const dynamic = "force-dynamic";

export default async function ClientGhlPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const [client, status] = await Promise.all([
    serverApi.get<{ id: number; name: string }>(`projects/clients/${id}`),
    serverApi.get<GhlStatus>(`projects/clients/${id}/ghl-connection`),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/clients" className="text-sm text-pink-700 hover:underline">Back to clients</Link>
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">{client.name} · GoHighLevel</h1>
        <p className="mt-2 text-sm text-slate-600">Connect this client&apos;s sub-account using its private integration token and location ID.</p>
      </div>
      <GhlConnectionForm clientId={client.id} initial={status} />
      <ContextPolicy clientId={client.id} />
    </div>
  );
}
