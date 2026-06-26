export type A2PStatus = "NEW" | "IN_REVIEW" | "SUBMITTED" | "APPROVED" | "REJECTED";

export const A2P_STATUSES: A2PStatus[] = ["NEW", "IN_REVIEW", "SUBMITTED", "APPROVED", "REJECTED"];

export const A2P_STATUS_LABEL: Record<string, string> = {
  NEW: "New",
  IN_REVIEW: "In review",
  SUBMITTED: "Submitted to registry",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export const A2P_STATUS_STYLE: Record<string, string> = {
  NEW: "bg-pink-50 text-pink-700 ring-pink-200",
  IN_REVIEW: "bg-amber-50 text-amber-700 ring-amber-200",
  SUBMITTED: "bg-sky-50 text-sky-700 ring-sky-200",
  APPROVED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  REJECTED: "bg-red-50 text-red-700 ring-red-200",
};

export type PhoneEntry = { number: string; label?: string };

export interface A2PSubmission {
  id: number;
  legal_business_name: string;
  dba_brand_name: string;
  ein_tax_id: string;
  business_type: string;
  business_industry: string;
  business_website: string;
  business_address: string;
  city: string;
  state: string;
  zip_code: string;
  business_email: string;
  business_phone: string;
  rep_first_name: string;
  rep_last_name: string;
  rep_email: string;
  rep_phone: string;
  rep_job_title: string;
  sms_use_case: string;
  message_types: string[];
  sms_program_description: string;
  optin_method: string;
  optin_form_url: string;
  has_sms_consent_checkbox: string;
  has_privacy_policy: string;
  privacy_policy_url: string;
  has_terms_of_service: string;
  terms_of_service_url: string;
  phone_numbers: PhoneEntry[];
  additional_notes: string;
  status: A2PStatus;
  review_notes: string;
  created_at: string;
  updated_at: string;
}

export function A2PStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${A2P_STATUS_STYLE[status] ?? "bg-slate-100 text-slate-600 ring-slate-200"}`}>
      {A2P_STATUS_LABEL[status] ?? status}
    </span>
  );
}
