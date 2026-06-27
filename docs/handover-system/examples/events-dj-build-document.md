# Implementation Build Document — Events / DJ Entertainment (redacted example)

> **What this is:** a worked example of the long-form, step-by-step output of
> `services.generate_build_document()` — the implementer-facing companion to the structured
> blueprint. Modeled on a real Calari build for an event-entertainment company (DJ / photo /
> video); client name, people, and domain are redacted. The external source-of-truth tool is
> referred to generically as the **Event Manager** (an event/contract/staffing system).
> Use this as the target format the generator should match and as what the assigned builder
> receives alongside the original meeting notes.

## 1. Business goals
- Make GoHighLevel the sales & marketing command center; keep the **Event Manager** as the
  source of truth for contracts, staffing, event logistics, and core financials.
- **Primary metric:** raise consult-to-booking from ~40–42% to **60%** by replacing the
  "nurture never stops after booking" flow with a dedicated post-consult sales sequence.
- Consolidate email (currently split across the Event Manager + a separate ESP) into one GHL
  pipeline; track booked/completed milestones for ad optimization.

## 2. CRM architecture
- **GoHighLevel** — CRM, pipeline, forms, calendars, email/SMS, sales automation, upsells,
  dashboards, ad conversion tracking.
- **Event Manager (external)** — contracts, staffing, event logistics, core/scheduled financials.
- **Website form** — captures lead + service interest (DJ / photo / video).
- **Zapier/webhook** — website lead → GHL.
- **Stripe or Square** (preferred over PayPal for scheduled-payment data) — payment links + upsell tracking.
- **Ads platform** — receives conversion events fired from GHL pipeline milestones.
- **Bridge rule:** the Event Manager reports milestones back into GHL via two GHL forms, matched on **phone number**.

## 3. Pipeline stages
`Sales Pipeline`: New Lead → Nurturing → Booked Phone Call → No Show → Showed / Consult Completed → Proposal Sent → Contract Sent → Booked / Deal Won → Lost.

## 4. Detailed pipeline flow
Lead enters from the website (Zapier) into **New Lead**, gets speed-to-lead SMS+email and an
internal alert, and is enrolled in **Nurturing** with a booking CTA. Booking a consult moves
them to **Booked Phone Call** and stops general nurture (pre-consult sequence begins). After the
call they go to **Showed / Consult Completed** (post-consult sales sequence) or **No Show**
(recovery). A proposal moves them to **Proposal Sent**; the Event Manager's "contract sent"
form moves them to **Contract Sent**; the "date booked / deposit" form moves them to
**Booked / Deal Won**, fires the purchase conversion, and starts the upsell campaign. Dead deals
→ **Lost** (re-open on reply).

## 5. Contact fields & custom values
Service Interest, Event Date, Event Type, Venue Name, Lead Source, Consult Booked Date, Consult
Outcome, Proposal Sent Date, Contract Sent Date, Booked Date, Deposit Collected, Total Package
Value, Event Manager Event ID, Payment Method, Upsell Purchased, Ad Campaign Source.
Custom values: `calendar_link`, `company_phone`, `business_address`, `review_link` _(needs value)_,
`upsell_products_url` _(needs value)_.

## 6. Tags
`lead:new`, `service:dj`, `service:photo`, `service:video`, `status:call-booked`,
`status:no-show`, `status:consult-completed`, `status:proposal-sent`, `status:contract-sent`,
`status:booked`, `status:lost`, `upsell:eligible`, `upsell:purchased`, `source:website`,
`source:ads`, `dnc`.

## 7. Lead sources
Website contact form (service checkboxes) → Zapier/webhook → GHL. (Ads drive traffic to the
same form; tag `source:ads` when UTM present.)

## 8. Calendar setup
`Consultation Call` calendar (round-robin across sales users), call recording attached to the
contact, confirmations + reminders enabled, books into **Booked Phone Call**. Two-way Google
Calendar sync so personal events block availability.

## 9. Forms needed
- **Website Contact Form** (name, phone, email, event date, service interest).
- **Event Manager – Contract Sent** (phone, name, event date, contract sent date, package value, service type, Event Manager Event ID).
- **Event Manager – Date Booked / Deposit Paid** (phone, booked date, deposit collected, total package value, payment method, Event Manager Event ID).

## 10. Automations / workflows needed (overview)
WF1 Website Lead Intake · WF2 Lead Nurture Until Call Booked · WF3 Appointment Booked /
Pre-Consult · WF4 No-Show Recovery · WF5 Post-Consult Sales Follow-Up · WF6 Contract Sent Form ·
WF7 Booked / Deal Won Form · WF8 Upsell Campaign · WF9 Reply Handler (stop-on-reply) ·
WF10 Reschedule Flow.

## 11–13. Trigger logic, branches, entry/exit — see each workflow below.

## 14. Email/SMS sequence structure
- **Nurture (until booked):** D0 SMS (book link) · D0 email (pricing/value) · D2 email (planning education) · D4 SMS (reminder) · D6 email (why us) · D9 email (service-specific) · D12 email (reviews) · D15 email (final CTA).
- **Pre-consult:** confirmation (immediate) · reminder 24h · reminder 2h · "what to expect" email.
- **Post-consult:** thank-you (D0) · recap (D0) · proof/reviews (D1) · urgency vs event date (D3) · final follow-up (D6).
- **Upsell:** add-on offer (booking+3d) · reminder w/ benefits (+5d).

## 15. Internal notifications
New lead → assigned rep (SMS+email, name/phone/service). Consult booked → assigned rep.
No-show final attempt → rep task. Contract Sent / Booked → sales channel + rep. Upsell purchased → rep.

## 16. External source-of-truth integration flow
The Event Manager emails the team to update GHL; the team submits **Event Manager – Contract
Sent** and **Event Manager – Date Booked / Deposit Paid** GHL forms. Each submission matches the
contact by **phone**, updates custom fields, advances the opportunity, and fires the ad event.

## 17. Payment / payment-link flow
Connect Stripe/Square (preferred) for scheduled-payment data; generate payment links for upsells
and attach to emails; optional processing fee. Deposits/contracts stay in the Event Manager.

## 18. Upsell flow
On Booked/Deal Won → `upsell:eligible` → wait 3d → add-on email w/ payment link (extra DJ hours,
lighting, photo booth, videography/photography add-ons, ceremony audio, additional shooters) →
wait 5d → reminder → on purchase add `upsell:purchased`, notify rep, update upsell revenue.

## 19. Reporting dashboards
Leads by Source · Calls Booked · Lead-to-Consult Rate · Consult Show Rate · **Consult-to-Booking
Rate** · Proposals Sent · Contracts Sent · Deals Won · Closed Revenue · Future Scheduled Revenue
· Upsell Revenue · Revenue by Service Type · Revenue by Ad Campaign.

## 20. Ad conversion tracking
Fire events at: consult booked (Lead), Contract Sent (InitiateCheckout), Booked/Deal Won
(Purchase with Total Package Value + Ad Campaign Source). Calendar bookings report directly to ads.

---

# Automations — full implementation detail

### WF1 — Website Lead Intake
- **Purpose:** create and route every new lead, instantly.
- **Trigger:** Inbound Webhook (Zapier) OR Form Submitted = Website Contact Form.
- **Enrollment/stop:** allow re-entry; stop on `status:call-booked`.
- **Steps:** 1) Find/Create contact by phone. 2) Set Lead Source + Ad Campaign Source (from UTM). 3) Add `source:website`/`source:ads`. 4) If/else on Service Interest → add `service:dj` / `service:photo` / `service:video`. 5) Create Opportunity in **New Lead** (value = blank). 6) Assign round-robin sales user. 7) Internal notification (SMS+email) to assigned user. 8) Send SMS: "Thanks for reaching out — book your consult here: {{custom_values.calendar_link}}". 9) Send intro email (pricing context + booking CTA). 10) Add to WF2.
- **Branches:** multi-service → enroll in evergreen/all-services nurture; single service → service-specific nurture.
- **Pipeline movement:** → New Lead. **Tags added:** source/service/`lead:new`. **Stop:** appointment booked. **Success metric:** % leads with consult booked within 7 days.

### WF2 — Lead Nurture Until Call Booked
- **Purpose:** educate + drive to book. **Trigger:** Opportunity entered **New Lead** (or `lead:new` added).
- **Enrollment/stop:** stop on calendar appointment booked, on contact reply (manual takeover), or `status:lost`.
- **Steps:** the D0–D15 sequence in §14, each an Email/SMS action with a Wait step between. After D15 with no booking → move to **Nurturing** holding + rep task.
- **Branches:** service tag selects the email variant set. **Pipeline:** New Lead → Nurturing. **Tags:** none added; removed by exit. **Notifications:** none. **Stop:** booked / replied / lost. **Success metric:** nurture→consult booking rate.

### WF3 — Appointment Booked / Pre-Consult
- **Purpose:** prep the lead, stop nurture. **Trigger:** Calendar appointment booked (Consultation Call).
- **Steps:** 1) Move opp → **Booked Phone Call**. 2) Remove `lead:new`; add `status:call-booked`. 3) Remove from WF2. 4) Confirmation email+SMS. 5) Wait until 24h before → reminder. 6) Wait until 2h before → reminder. 7) "What to expect" email. 8) Internal notification to assigned rep.
- **Branches:** appointment status = showed → WF5 (Showed/Consult Completed); = no-show → WF4. **Stop:** appointment status resolved. **Success metric:** consult show rate.

### WF4 — No-Show Recovery
- **Purpose:** recover missed consults. **Trigger:** appointment status = no-show (or `status:no-show` added).
- **Steps:** 1) Move opp → **No Show**. 2) Add `status:no-show`. 3) SMS w/ rebooking link. 4) Email "sorry we missed you". 5) Wait 2 days → if no new appt, 2nd SMS. 6) Wait 5 days → if still none, rep task. 
- **Branches:** rebooked → back to **Booked Phone Call** (WF3); no response after final → **Lost**. **Success metric:** no-show recovery rate.

### WF5 — Post-Consult Sales Follow-Up
- **Purpose:** lift consult-to-booking to 60%. **Trigger:** opp moved → **Showed / Consult Completed**.
- **Steps:** add `status:consult-completed` → thank-you (D0) → recap (D0) → wait 1d → proof/reviews → wait 2d → urgency email keyed to Event Date → wait 3d → final follow-up.
- **Branches:** proposal sent → **Proposal Sent**; Event Manager contract form → **Contract Sent** (WF6); declined → **Lost**. **Success metric:** consult-to-booking rate.

### WF6 — Contract Sent Form
- **Purpose:** let the Event Manager report the contract milestone. **Trigger:** Form submitted = Event Manager – Contract Sent.
- **Steps:** match by phone → update Contract Sent Date / Package Value / Service Type / Event Manager Event ID → move opp → **Contract Sent** → add `status:contract-sent` → internal notification → fire ad event (InitiateCheckout). **Exit:** date-booked form → WF7. **Success metric:** contract→booked rate.

### WF7 — Booked / Deal Won Form
- **Purpose:** the true purchase event for reporting + ads. **Trigger:** Form submitted = Event Manager – Date Booked / Deposit Paid.
- **Steps:** match by phone → update Booked Date / Deposit Collected / Total Package Value / Payment Method → move opp → **Booked / Deal Won**, mark Won → remove active sales-nurture tags, add `status:booked` → fire Purchase conversion (value + Ad Campaign Source) → notify team → start WF8. **Success metric:** booked revenue by source; consult-to-booking rate.

### WF8 — Upsell Campaign
- **Purpose:** sell add-ons post-booking. **Trigger:** opp = **Booked / Deal Won**.
- **Steps:** add `upsell:eligible` → wait 3d → add-on email w/ payment link (by package) → wait 5d → reminder → on payment link purchase add `upsell:purchased`, notify rep, update upsell revenue. **Stop:** `upsell:purchased` or `dnc`. **Success metric:** upsell attach rate / revenue.

### WF9 — Reply Handler (stop-on-reply)
- **Trigger:** Customer replied (email/SMS). **Steps:** add `replied`, notify assigned rep with the message, remove from active nurtures (manual takeover). **Success metric:** speed-to-first-human-touch.

### WF10 — Reschedule Flow
- **Trigger:** appointment rescheduled. **Steps:** clear queued reminders, re-queue 24h/2h reminders for the new time, keep stage. **Success metric:** reminder accuracy / no stale sends.

---

## Per-stage operating notes (enter / in-stage / exit / risks / reporting)
- **New Lead** — enter: website/Zapier lead. in-stage: WF1 speed-to-lead + WF2 nurture. exit: consult booked / unresponsive. risk: duplicate contacts (use phone match + sticky contacts). report: Leads by Source, Lead-to-Consult Rate.
- **Nurturing** — enter: not booked. in-stage: educational + booking CTA. exit: booked. risk: nurture continuing post-booking (WF3 must remove from WF2). report: nurture→consult rate.
- **Booked Phone Call** — enter: calendar booking. in-stage: pre-consult sequence. exit: showed/no-show. risk: no-shows; reminders 24h/2h mitigate. report: Consult Show Rate.
- **No Show** — enter: missed appt. in-stage: WF4. exit: rebooked / lost. risk: over-messaging; cap attempts. report: no-show recovery rate.
- **Showed / Consult Completed** — enter: completed call. in-stage: WF5. exit: proposal/contract/lost. risk: slow follow-up; automate D0. report: **Consult-to-Booking Rate**.
- **Proposal Sent / Contract Sent** — enter: proposal / Event Manager form. in-stage: follow-up + ad milestone. exit: booked / lost. risk: form not submitted by ops; send the Event Manager reminder. report: Proposals/Contracts Sent, conversion.
- **Booked / Deal Won** — enter: deposit form. in-stage: WF8 upsell. exit: onboarding/upsell. risk: missed purchase event → wrong ROAS; verify ad event fires. report: Closed/Future Revenue, Revenue by Service/Campaign.
- **Lost** — enter: declined/unresponsive. in-stage: sales workflows stopped. exit: re-open on reply. report: loss reasons.

## 21. Testing checklist
Test website→Zapier→GHL contact creation; service-tag branching; speed-to-lead SMS/email + alert; nurture stops on booking; pre-consult reminders fire at 24h/2h; no-show recovery + rebooking; post-consult sequence; both Event Manager forms match by phone and advance the opp; ad events fire (Lead / InitiateCheckout / Purchase with value); upsell payment link tags + revenue; reschedule clears stale reminders; **A2P/SMS compliance** verified (consent flow, brand+campaign approved, sending number is local not toll-free).

## 22. Launch checklist
Domain/DNS + email authentication (SPF/DKIM/DMARC) and warm-up; calendars live with round-robin; pipelines/stages/colors; all custom fields/values/tags; payment processor connected; ad event mapping verified; dashboards built; **A2P brand + campaign approved and numbers linked**; team trained; go-live monitoring.

## 23. 2–3 week timeline
- **Week 1:** account cleanup; domain/DNS + email warm-up start; pipeline + fields + tags; calendar; website/Zapier capture; A2P brand/campaign submitted.
- **Week 2:** nurture, pre-consult, no-show, post-consult workflows; Event Manager reporting forms; payment + upsell links; reply/reschedule handlers.
- **Week 3:** dashboards; ad conversion testing; full QA; team training; launch + monitor. A2P approval confirmed.

## 24. Client assets/information needed before build
Domain DNS access (for 6 sending records); logo/brand + email signatures + assigned sender; current email templates (Loom walkthrough) and the "which template at which stage" map; full product/add-on list (for upsell links); Google review link; payment processor (Stripe/Square) credentials; Event Manager contract/booked email triggers; ad account access for conversion setup; the legal business name/DBA + opt-in URL for A2P.
