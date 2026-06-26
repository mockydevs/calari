# Calari build patterns — cross-vertical reference (redacted)

> Distilled from Calari/Kaizen's delivered builds across dental, med-spa/aesthetics,
> recruitment, home services (stone/countertops), auto, events/wedding, and app-integration
> projects. Client names, people, domains, emails, phone numbers and report links are removed.
> This is a **learning-loop reference** (`use_for_ai=True`): it teaches the blueprint generator
> the deliverables an expert includes even when the meeting notes don't spell them out.

## 1. Pipelines
Most builds use a 7–8 stage lead-to-outcome pipeline. Common shapes:
- **Lead/appointment:** New Lead → Nurture/Follow-Up → Appointment Booked → Confirmed/Scheduled → Completed → (No Response / Closed Won / Closed Lost).
- **Recruitment:** New Applicants → Send Survey → Submitted Survey → Qualified → Interview Scheduled → Hired → Rejected.
Stage colors are applied for at-a-glance scanning. One pipeline = one source of truth; consolidate duplicates and preserve existing opportunities during any rebuild.

## 2. Standard workflows (an expert includes these even if unstated)
- **Speed-to-lead:** auto-reply email + SMS within ~5 minutes of a form fill; internal alert to the **assigned** rep (never all users) with name/phone + a follow-up task.
- **Lead-source router:** tag every contact with origin (web form / Meta / phone / referral) for clean attribution; fire only for the correct forms/pages.
- **Lead-value calculator:** read a budget/qualification field and set the opportunity value automatically; always set the stage explicitly on each branch so it isn't accidentally cleared.
- **Nurture:** separate unqualified (warm-up) vs qualified (push-to-book) sequences; multi-touch SMS+email; **exit/suppress on booking** so booked leads stop getting "please book" messages.
- **Appointment lifecycle:** booking confirmation; reminders 24h + 1–2h before; **no-show recovery** (graduated, only mark Lost after a rebooking window); **reschedule flow** that clears stale reminders and queues fresh ones.
- **Post-visit:** review request + referral ask after completion.
- **Pipeline-stage movers:** lightweight workflows keeping the board accurate on confirmed/completed/won/lost.
- **Embedded AI qualification:** an AI step that validates eligibility (e.g., applicant state) and routes or auto-disqualifies.

## 3. Integrations & data flows
- **External app sync (bidirectional GHL ↔ client app):** appointments, estimates/quotes, invoices, and pipeline-stage status sync in real time; verify end-to-end.
- **Inbound call intelligence:** pull call leads via the provider API/GraphQL and upsert into GHL; map every data point to custom fields.
- **Online scheduling without a native integration:** when the booking tool has no native GHL connector, bridge it with Google Tag Manager → GHL inbound webhook (watch for the scheduler not actually injecting the GTM container).
- **Reporting pipelines:** data source → daily Google Sheet sync (rolling window) → reporting tool scorecards across Last 7 Days / Month-to-Date / Last Month. Note **sync latency** (sheet may lag several hours) and **rounding variance** (whole-number spend exports), and keep the original report as a fallback.
- **Conversion APIs:** once leads convert, configure Meta/Google Ads Conversion APIs to send events back for optimization.

## 4. A2P / SMS compliance — the most common go-live blocker
Required whenever the build sends SMS. Deliverables and hard-won lessons:
- **Documents:** compliant Privacy Policy (with a dedicated SMS Messaging & Consent section and the mandatory "no mobile information will be shared with third parties/affiliates for marketing" clause, verbatim) and Terms of Service (STOP/HELP, carrier-liability disclaimer, message-frequency disclosure, age restriction).
- **Consent flow:** unchecked SMS-consent checkbox, optional phone field, visible Privacy/Terms links by the consent language, "consent not required to purchase", and "message & data rates may apply". Build the form in plain HTML so automated reviewers can always see the checkbox.
- **Registration:** connect the approved brand to a Twilio Messaging Service; register a **Customer Care / transactional** campaign with carrier-compliant sample messages (confirmations, reminders, follow-ups).
- **Known failure modes (raise as gaps / plan around):**
  - **Error 30896 (opt-in):** reviewers can't verify opt-in — usually because the main marketing site conflicts with a transactional Customer-Care registration. Fix: build a **standalone compliance website** dedicated to the opt-in form + Privacy Policy + Terms, with no promotional content; you may need GHL Support to **delete the approved brand** for a clean resubmission.
  - **Toll-free numbers do not connect to GHL** — purchase a **local** number, attach it to the verified brand/campaign, then connect to GHL.
  - Brand/SHAKEN-STIR can be approved while the campaign is still in review (typically 3–5 business days); link sending numbers to the approved campaign before texting.

## 5. Quality hygiene an expert always sets
- Sticky/dedup contacts (existing leads update their record instead of creating duplicates); dedup match email-first-then-phone.
- Two-way calendar sync (Google/Microsoft) so external events block availability.
- Correct email **sender identity**: assign a user so From-name and signature merge tags resolve; never ship emails referencing empty location-level custom values for per-contact data.
- Disable duplicate/default confirmations; consolidate reminders into one workflow at the right intervals.
- Document the build (handover + code/integration references) on delivery.
