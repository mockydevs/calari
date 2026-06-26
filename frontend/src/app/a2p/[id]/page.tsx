import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileDown } from "lucide-react";
import { requireAdmin } from "@/lib/auth-helpers";
import { serverApi } from "@/lib/portal/server";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { updateA2PSubmission } from "../actions";
import { A2PStatusBadge, A2P_STATUSES, A2P_STATUS_LABEL, type A2PSubmission } from "../_shared";

export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-50 py-2 sm:flex-row sm:gap-4">
      <span className="w-56 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <span className="text-sm text-slate-800">{value}</span>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-3"><h2 className="text-sm font-semibold text-slate-950">{title}</h2></div>
      <div className="px-5 py-2">{children}</div>
    </section>
  );
}

export default async function A2PDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const s = await serverApi.get<A2PSubmission>(`a2p/submissions/${id}`).catch(() => null);
  if (!s) notFound();

  const yn = (v: string) => (v === "yes" ? "Yes" : v === "no" ? "No" : v === "unsure" ? "Not sure" : v || "—");
  const link = (url: string) => url ? <a href={url} target="_blank" rel="noreferrer" className="text-pink-700 hover:underline">{url}</a> : "—";

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <Link href="/a2p" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> A2P intake
      </Link>

      <section className="rounded-lg border border-slate-200/80 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-1.5"><A2PStatusBadge status={s.status} /></div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{s.legal_business_name}</h1>
            {s.dba_brand_name && <p className="mt-1 text-sm text-slate-600">DBA: {s.dba_brand_name}</p>}
            <p className="mt-1 text-xs text-slate-400">Submitted {formatDate(s.created_at)}</p>
          </div>
          <div className="flex items-end gap-2">
            <a
              href={`/api/portal/a2p/submissions/${s.id}/export-pdf`}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <FileDown className="h-4 w-4" /> PDF
            </a>
            <form action={updateA2PSubmission} className="flex items-end gap-2">
              <input type="hidden" name="id" value={s.id} />
              <div className="space-y-1">
                <Label htmlFor="status" className="text-xs">Status</Label>
                <Select id="status" name="status" defaultValue={s.status} className="h-9">
                  {A2P_STATUSES.map((st) => <option key={st} value={st}>{A2P_STATUS_LABEL[st]}</option>)}
                </Select>
              </div>
              <Button type="submit" size="sm" variant="outline">Update</Button>
            </form>
          </div>
        </div>
      </section>

      <Panel title="Business details">
        <Row label="EIN / Tax ID" value={s.ein_tax_id} />
        <Row label="Business type" value={s.business_type} />
        <Row label="Industry" value={s.business_industry} />
        <Row label="Website" value={link(s.business_website)} />
        <Row label="Address" value={`${s.business_address}, ${s.city}, ${s.state} ${s.zip_code}`} />
      </Panel>

      <Panel title="Contact & representative">
        <Row label="Business email" value={s.business_email} />
        <Row label="Business phone" value={s.business_phone} />
        <Row label="Representative" value={`${s.rep_first_name} ${s.rep_last_name} — ${s.rep_job_title}`} />
        <Row label="Rep email" value={s.rep_email} />
        <Row label="Rep phone" value={s.rep_phone} />
      </Panel>

      <Panel title="Brand & use case">
        <Row label="Use case" value={s.sms_use_case} />
        <Row label="Message types" value={(s.message_types ?? []).join(", ") || "—"} />
        <Row label="Program description" value={<span className="whitespace-pre-wrap">{s.sms_program_description}</span>} />
      </Panel>

      <Panel title="Opt-in & compliance">
        <Row label="Opt-in method" value={s.optin_method} />
        <Row label="Opt-in form URL" value={link(s.optin_form_url)} />
        <Row label="SMS consent checkbox" value={yn(s.has_sms_consent_checkbox)} />
        <Row label="Privacy policy" value={`${yn(s.has_privacy_policy)}${s.privacy_policy_url ? "" : ""}`} />
        <Row label="Privacy policy URL" value={link(s.privacy_policy_url)} />
        <Row label="Terms of service" value={yn(s.has_terms_of_service)} />
        <Row label="Terms of service URL" value={link(s.terms_of_service_url)} />
      </Panel>

      <Panel title="Phone numbers">
        {(s.phone_numbers ?? []).length === 0 ? <p className="py-2 text-sm text-slate-500">None.</p> : (
          <ul className="py-1 text-sm text-slate-800">
            {s.phone_numbers.map((p, i) => (
              <li key={i} className="py-1">{p.number}{p.label ? <span className="text-slate-400"> — {p.label}</span> : null}</li>
            ))}
          </ul>
        )}
      </Panel>

      {s.additional_notes && (
        <Panel title="Additional notes">
          <p className="py-2 text-sm whitespace-pre-wrap text-slate-800">{s.additional_notes}</p>
        </Panel>
      )}

      <Panel title="Internal review notes">
        <form action={updateA2PSubmission} className="space-y-2 py-2">
          <input type="hidden" name="id" value={s.id} />
          <Textarea name="review_notes" rows={3} defaultValue={s.review_notes} placeholder="Notes for the team (not shown to the client)…" />
          <Button type="submit" size="sm" variant="outline">Save notes</Button>
        </form>
      </Panel>
    </div>
  );
}
