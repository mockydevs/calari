import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { requireAdmin } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import { formatDate } from "@/lib/utils";
import { A2PStatusBadge, type A2PSubmission } from "./_shared";
import { ExportCsvButton } from "./export-button";

export const dynamic = "force-dynamic";

function asList<T>(d: T[] | { results: T[] }): T[] {
  return Array.isArray(d) ? d : d.results ?? [];
}

export default async function A2PListPage() {
  await requireAdmin();
  const items = await serverApi
    .get<A2PSubmission[] | { results: A2PSubmission[] }>("a2p/submissions")
    .then(asList)
    .catch(() => [] as A2PSubmission[]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-950">
          <MessageSquare className="h-6 w-6 text-pink-700" /> A2P / 10DLC intake
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          SMS-compliance registration questionnaires submitted from the website intake form.
        </p>
      </div>

      <section className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-950">Submissions ({items.length})</h2>
          <ExportCsvButton items={items} />
        </div>
        {items.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No submissions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3">Business</th>
                  <th className="px-5 py-3">Use case</th>
                  <th className="px-5 py-3">Representative</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {items.map((s) => (
                  <tr key={s.id} className="transition-colors hover:bg-pink-50/30">
                    <td className="px-5 py-3.5">
                      <Link href={`/a2p/${s.id}`} className="font-semibold text-pink-700 hover:underline">
                        {s.legal_business_name}
                      </Link>
                      {s.dba_brand_name && <span className="ml-1 text-xs text-slate-400">({s.dba_brand_name})</span>}
                    </td>
                    <td className="px-5 py-3.5 text-slate-600">{s.sms_use_case}</td>
                    <td className="px-5 py-3.5 text-slate-600">{s.rep_first_name} {s.rep_last_name}<span className="block text-xs text-slate-400">{s.rep_email}</span></td>
                    <td className="px-5 py-3.5"><A2PStatusBadge status={s.status} /></td>
                    <td className="px-5 py-3.5 text-slate-500">{formatDate(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
