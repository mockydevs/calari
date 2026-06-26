"use client";

import { Download } from "lucide-react";
import { A2P_STATUS_LABEL, type A2PSubmission } from "./_shared";

const COLUMNS: { header: string; get: (s: A2PSubmission) => string }[] = [
  { header: "ID", get: (s) => String(s.id) },
  { header: "Status", get: (s) => A2P_STATUS_LABEL[s.status] ?? s.status },
  { header: "Submitted", get: (s) => s.created_at },
  { header: "Legal business name", get: (s) => s.legal_business_name },
  { header: "DBA / brand", get: (s) => s.dba_brand_name },
  { header: "EIN / Tax ID", get: (s) => s.ein_tax_id },
  { header: "Business type", get: (s) => s.business_type },
  { header: "Industry", get: (s) => s.business_industry },
  { header: "Website", get: (s) => s.business_website },
  { header: "Address", get: (s) => `${s.business_address}, ${s.city}, ${s.state} ${s.zip_code}` },
  { header: "Business email", get: (s) => s.business_email },
  { header: "Business phone", get: (s) => s.business_phone },
  { header: "Rep name", get: (s) => `${s.rep_first_name} ${s.rep_last_name}` },
  { header: "Rep title", get: (s) => s.rep_job_title },
  { header: "Rep email", get: (s) => s.rep_email },
  { header: "Rep phone", get: (s) => s.rep_phone },
  { header: "Use case", get: (s) => s.sms_use_case },
  { header: "Message types", get: (s) => (s.message_types ?? []).join("; ") },
  { header: "Program description", get: (s) => s.sms_program_description },
  { header: "Opt-in method", get: (s) => s.optin_method },
  { header: "Opt-in form URL", get: (s) => s.optin_form_url },
  { header: "SMS consent checkbox", get: (s) => s.has_sms_consent_checkbox },
  { header: "Privacy policy", get: (s) => s.has_privacy_policy },
  { header: "Privacy policy URL", get: (s) => s.privacy_policy_url },
  { header: "Terms of service", get: (s) => s.has_terms_of_service },
  { header: "Terms of service URL", get: (s) => s.terms_of_service_url },
  { header: "Phone numbers", get: (s) => (s.phone_numbers ?? []).map((p) => `${p.number}${p.label ? ` (${p.label})` : ""}`).join("; ") },
  { header: "Additional notes", get: (s) => s.additional_notes },
  { header: "Review notes", get: (s) => s.review_notes },
];

function csvCell(v: string): string {
  const needsQuote = /[",\n]/.test(v);
  const escaped = v.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

export function ExportCsvButton({ items }: { items: A2PSubmission[] }) {
  function download() {
    const rows = [
      COLUMNS.map((c) => csvCell(c.header)).join(","),
      ...items.map((s) => COLUMNS.map((c) => csvCell(c.get(s) ?? "")).join(",")),
    ];
    const blob = new Blob(["﻿" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `a2p-submissions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={items.length === 0}
      className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
    >
      <Download className="h-3.5 w-3.5" /> Export CSV
    </button>
  );
}
