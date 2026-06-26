# Dental Patient Acquisition — System Operation & Handover

*Client: Coastal Family Dental (anonymized)*

> Every lead — website, Patient Prism call, relo, or online booking — lands in one pipeline and moves itself forward until the appointment is completed; staff only log the 3-month value and mark Lost.

## 1. The big idea

Everything funnels into one GoHighLevel pipeline — Patient Acquisition — which is the single source of truth for every lead regardless of source. The team works one board daily; automations move leads forward wherever there is a reliable signal (form submit, relo tag, booking webhook, appointment status), and the team manually handles the few judgment steps (logging the 3-month value, marking Lost). Four sources feed it: website form fills, Patient Prism relo (reload) call leads, Patient Prism general call events, and Modento online bookings.

## 2. Lead sources

| Source | How it enters | Fires | Tags | Workflow | Entry stage |
|---|---|---|---|---|---|
| Website form fills | GHL 'Form Submitted' trigger | Internal team email + task to the practice owner; UTM source tagging | Website, source UTM tags (Meta / Google / paid / none) | IN1 - Website Form Leads | New Lead – Unqualified |
| Patient Prism reload (relo) leads | Python cron sync → GHL Contacts API upsert (dedup by phone), then tag added as a separate call | Meta CAPI, internal relo alert, task to the practice owner | new-opportunity, follow-up, not-booked, patient_prism_call | A1 - Patient Prism Relo Leads (to Qualified) | Qualified Lead |
| Patient Prism general call events | Inbound webhook from Patient Prism | Meta CAPI | follow-up, booked-appointment, showed, no-show | IN2 - Patient Prism Call Conversion Events (non-relo) | Routes by tag (New Lead – Unqualified / Appointment Booked / First Appointment Completed) |
| Modento online bookings | Browser-side Google Tag Manager capture → GHL inbound webhook (secret-validated) on the 'Scheduled appointment' event | Create opportunity; suppression tag to exit nurtures | booked, suppression tag (do-not-contact / qualified) | REC1 - Modento Booking to GHL (Appointment Booked) | Appointment Booked |

## 3. The pipeline

| # | Stage | What it means | How a lead gets here | Auto/Manual |
|---|---|---|---|---|
| 1 | New Lead – Unqualified | A fresh lead that still needs to be qualified. | Website form fills; generic Patient Prism call contacts. | Auto |
| 2 | Qualified Lead | A Patient Prism reload lead — should have booked but didn't; worth calling back. | Relo sync tag 'new-opportunity'; also a cancelled appointment drops back here. | Auto |
| 3 | Appointment Booked | Lead has an appointment. | Modento online booking; Patient Prism 'booked'; a no-show stays here for rebooking. | Auto |
| 4 | Scheduled | Appointment confirmed / upcoming. | Appointment status = confirmed (auto via the appointment-confirmed workflow). | Auto |
| 5 | First Appointment Completed | Patient attended their first visit; initial value logged. | Appointment status = showed (auto via sync-tag workflow); Patient Prism 'showed'. | Auto |
| 6 | 3-Month Value Completed | True patient value known after follow-up work (crowns, extractions, etc.). | Manual team move ~2–3 months later once the PMS reflects the true value. | Manual |
| 7 | Spam | Bad / disqualified lead (Medicaid-only, junk) kept for clean conversion reporting. | Auto via the invalid-tag workflow; or manual. | Auto |
| 8 | Lost | Got far but didn't close. | Manual team move. | Manual |

## 4. Stage movement

| Transition | Trigger | Auto/Manual |
|---|---|---|
| — → New Lead – Unqualified | Website form submitted | Auto |
| — → Qualified Lead | Relo sync adds tag 'new-opportunity' | Auto |
| — → Appointment Booked | Modento booking webhook (secret-validated) | Auto |
| New Lead – Unqualified → Appointment Booked | Lead books online / is booked | Auto |
| Qualified Lead → Appointment Booked | Reload lead books | Auto |
| Appointment Booked → Scheduled | Appointment status = confirmed | Auto |
| Scheduled → First Appointment Completed | Appointment status = showed | Auto |
| First Appointment Completed → 3-Month Value Completed | Team logs true value ~2–3 months later | Manual |
| Appointment Booked → Qualified Lead | Appointment cancelled | Auto |
| Appointment Booked → Spam | Appointment status = invalid | Auto |
| Appointment Booked → Lost | Manual — deal dead | Manual |

## 5. Calendars — the conversion points

| Calendar | Type | Books | Assigned to | Books into | On booking |
|---|---|---|---|---|---|
| Online booking page (new-patient & emergency) | Service | Books new-patient visits ($199 new-patient special) and emergency exams ($59) — the single booking page embedded in every nurture. | Practice providers | Appointment Booked | GTM tag POSTs to the GHL inbound webhook → create opportunity in Appointment Booked; apply suppression tag so 'please book' nurtures stop. |

## 6. Integrations & data flows

| System | Direction | Mechanism | Data | Cadence | Purpose |
|---|---|---|---|---|---|
| Patient Prism (relo sync) | Inbound | Cron | contacts, AI call summary, opportunity dollar value, call recording URL, lead sentiment, agent sentiment | Daily cron (increase frequency for near-real-time) | Push only true reload leads into GHL and enrich the contact so the relo surfaces in Qualified with its dollar value. |
| Patient Prism (call events) | Inbound | Webhook | contacts, call event type (booked / showed / no-show / follow-up) | Real-time on call event | Route general call outcomes into the pipeline and fire Meta CAPI. |
| Modento / Dental Intelligence | Inbound | Webhook | contacts (name, phone, email, DOB), booking event | Real-time on 'Scheduled appointment' | Capture online bookings as conversions in GHL. |
| Meta Conversion API | Outbound | API | conversion events | On lead / conversion event | Feed conversions back to Meta so ads can optimize for sales-qualified leads. |

## 7. Every workflow, grouped by function


### Intake & routing (IN)

| Workflow | Trigger | What it does |
|---|---|---|
| IN1 — Website Form Leads | Form submitted | Branches by UTM source, tags the source, updates fields, creates the opportunity in New Lead – Unqualified. |
| IN2 — Patient Prism Call Conversion Events (non-relo) | Inbound webhook | Creates the contact then routes by tag into the right stage; fires Meta CAPI. |

### Active conversion (A)

| Workflow | Trigger | What it does |
|---|---|---|
| A1 — Patient Prism Relo Leads (to Qualified) | Contact tag added: new-opportunity | Creates the opportunity in Qualified Lead with the synced dollar value, fires Meta CAPI, sends the relo alert and a task to the owner. |
| C — Unqualified Lead Nurture | Enters New Lead – Unqualified | Welcome email then a multi-step nurture with a 'Book your appointment' CTA driving to the online booking page. |
| D — Qualified Lead Booking Push | Enters Qualified Lead | SMS + email with the booking link to push reload leads to rebook. |

### Record-keeping (REC)

| Workflow | Trigger | What it does |
|---|---|---|
| REC1 — Modento Booking to GHL | Inbound webhook (secret-validated) | Creates the contact and the opportunity in Appointment Booked; applies the suppression tag. |

### Appointment lifecycle (E, K)

| Workflow | Trigger | What it does |
|---|---|---|
| E — Appointment Confirmed to Scheduled | Appointment status = confirmed | Tags and moves the opportunity to Scheduled (status open). |
| F — No Show Recovery | Contact tag added: no-show | Recovery nurture; keeps the opportunity in Appointment Booked for rebooking. |
| K1 — Sync Confirmed Tag | Appointment confirmed | Adds the 'confirmed' tag. |
| K2 — Sync Cancelled Tag | Appointment cancelled | Adds the tag and moves the opportunity back to Qualified Lead to re-engage. |
| K3 — Sync New Tag | Appointment new | Adds the 'new' tag. |
| K4 — Sync Showed Tag | Appointment showed | Adds the tag and moves the opportunity to First Appointment Completed. |
| K5 — Sync Invalid Tag | Appointment invalid | Adds the tag and moves the opportunity to Spam. |
| K6 — Sync No-Show Tag | Appointment no-show | Adds the 'no-show' tag (which triggers No Show Recovery). |

### Post-visit & retention (G)

| Workflow | Trigger | What it does |
|---|---|---|
| G — Post Visit Reviews and Referrals | Enters First Appointment Completed | Thank-you email, then a review request and a referral ask. |

### Internal & utility (H, X, Y, Z)

| Workflow | Trigger | What it does |
|---|---|---|
| H — Internal Team Notification | Form submitted | Internal email to front desk + a task to the practice owner. |
| X — Booking-Link Click Qualifier | Calendar booking link clicked | Tags and updates the opportunity as a hot engagement signal. |
| Y — Lead Reply to Team Alert | Customer replied (email/SMS) | Tags and sends an internal alert so the team jumps on engaged leads. |
| Z — Global Exits and Suppression | Tags booked / qualified / do-not-contact | Removes the contact from active nurtures to prevent over-messaging. |

## 8. Custom fields, values & tags


**Custom fields:** `pp_call_summary`, `pp_opportunity_value`, `pp_call_recording_url`, `pp_lead_sentiment`, `pp_agent_sentiment`

**Custom values:** `calendar_link`, `phone`, `business_address`, `google_reviews_link` _(needs value)_, `referral_incentive_amount` _(needs value)_, `promotion_name` _(needs value)_, `hours_of_operation` _(needs value)_

**Tag glossary:** `new-opportunity` (Reload lead identified by Patient Prism (triggers the relo workflow).), `follow-up` (Patient Prism follow-up recommended.), `booked-appointment` (Patient Prism booked event.), `showed` (Patient attended the appointment.), `no-show` (Patient missed the appointment (triggers recovery).), `confirmed` (Appointment confirmed.), `cancelled` (Appointment cancelled.), `invalid` (Disqualified / spam lead.), `patient_prism_call` (Source tag for any Patient Prism call contact.), `do-not-contact` (Suppression — exit all nurtures.)

## 9. Maintenance notes

Relo sync is a standalone Python cron service (runs ~daily) that reads Patient Prism and writes to the GHL Contacts API; env vars: PATIENT_PRISM_TOKEN, GHL_TOKEN, GHL_LOCATION_ID. GHL token needs contacts.write + locations/customFields.readonly. The sync's SQLite state DB is production data — back it up. Online bookings depend on a GTM container (capture tag + send tag, secret-validated webhook); changes must be published. Meta CAPI fires from the call-events workflow for ad optimization. Increase the cron frequency if near-real-time relos are required.

## 10. Pre-launch checklist

- [ ] Populate google_reviews_link with the practice's Google review URL (review CTAs are dead until then).
- [ ] Set referral_incentive_amount and fix the referral email placeholder text + the 'Refer a friend' button destination.
- [ ] Confirm the online-booking workflow applies a suppression tag so booked patients stop receiving 'please book' nurtures.
- [ ] Verify the dedup rule (email first, then phone) in settings before heavy live traffic. _(optional)_
- [ ] Decide the relo sync cadence (daily vs hourly) to match the 'call within ~10 min' expectation. _(optional)_
- [ ] Confirm whether the engagement utilities (booking-link click qualifier, SMS reply handler) should be live or draft. _(optional)_
- [ ] Throttle the Performance Max ad campaigns driving low-quality leads. _(optional)_
- [ ] Deliver team training and run an end-to-end live test (form, relo, booking, status changes).
