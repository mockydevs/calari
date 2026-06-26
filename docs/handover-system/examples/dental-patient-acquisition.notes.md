# Example input — Dental patient-acquisition build (kickoff + follow-up notes)

> Redacted, anonymized meeting notes modeled on a real Calari GHL build for a Florida
> dental practice. All names, emails, phone numbers, GHL location IDs, webhook URLs and
> secrets have been replaced with placeholders. This file is the **input** the blueprint
> generator receives; `dental-patient-acquisition.blueprint.json` is the expected output
> and `dental-patient-acquisition.handover.md` is the rendered handover.

**Client:** Coastal Family Dental (anonymized) — single-location dental practice, FL
**Attendees:** Account manager (Calari), practice owner (client), builder (Calari)
**Goal stated by owner:** "I just want to go live with all of the leads in one place."

---

## Kickoff notes

We're building a single lead-management pipeline in GoHighLevel that pulls together three
data sources so nothing slips through the cracks (the practice currently tracks leads in a
spreadsheet):

1. **Website form fills.**
2. **Patient Prism** — AI listens to inbound calls and flags "reload leads" (callers who
   should have booked but didn't), with an attributed dollar value and an AI call summary.
3. **Dental Intelligence / Modento** — online booking + practice-management data.

Current state per the builder: pipeline is set up with smart tags for sorting leads;
Dental Intelligence is connected and real bookings are already flowing in; email sequences
are built and loaded, they just need wiring to the right pipeline stages. Contact dedup is
configured to match by **email first, then phone**. The one missing piece: reload leads land
in GHL as plain contacts but aren't filtered into the pipeline or firing a notification yet.

### Pipeline stages we agreed on
- **New Lead (Unqualified)** — website form fills (need outreach to qualify).
- **Qualified Lead** — Patient Prism reload leads (should've booked, call them back).
- **Appointment Booked** — Dental Intelligence / Modento online bookings.
- **Scheduled** — appointment confirmed.
- **First Appointment Completed** — patient attended; initial value logged.
- **3-Month Value Completed** — true patient value once the PMS reflects later work (crowns,
  etc.); logged manually ~2–3 months later.
- **Spam** — bad/disqualified leads (Medicaid-only, junk) kept for conversion-quality tracking.
- **Lost** — got far but didn't close.

### Decisions
- GHL is the single source of truth.
- Reload-lead alert = **task + push notification** (flagged within ~10 min while the call is
  fresh; no email needed).
- Call-disqualified leads (e.g. insurance not accepted) = **contacts only, not in pipeline**
  (AI summary retained).
- Nurture sequences for all new leads push them to call or book online; the booking link is
  embedded in every nurture email and carries **two services**: $199 new-patient special and
  $59 emergency exam.
- Patient Prism AI call coaching/summary → eventually pumped into a contact **note** (wanted,
  not required at launch).
- Revenue attribution: log initial value at first appointment, update with true value later.
- Ads: lower the Performance Max campaigns — they're driving high-volume, low-quality leads
  because there's no API data yet to optimize for sales-qualified leads.

### Open / pending
- Bring call recordings / phone numbers into GHL (attach to contact), or leave in Patient
  Prism? (owner to decide)
- Confirm "Spam" as the bad-lead column name (tentatively agreed).
- Split "Completed" into First Appointment + 3-Month Value (agreed in concept, deferred).

---

## Follow-up notes (later session — corrections & how the data actually arrives)

- **Reload leads do NOT arrive by webhook.** They come from a standalone Python cron service
  that reads Patient Prism call records and pushes only true relos into GHL via the Contacts
  API, then adds the tag `new-opportunity` as a separate call. So the relo workflow must
  trigger on **tag added: `new-opportunity`**, not on contact-created. The cron runs ~daily.
- A relo = classification "New Opportunity" AND booking status "Not Booked" AND follow-up
  recommended = true, with a valid phone. Dedup by phone.
- The sync also writes contact custom fields: AI call summary, opportunity dollar value, call
  recording URL, lead sentiment, agent sentiment.
- **Online bookings arrive via Google Tag Manager**, not a DI email/API path: a browser tag on
  the booking page captures the patient fields and POSTs them to a GHL inbound webhook on the
  `Scheduled appointment` event, validated by a shared secret. The booking is the conversion —
  GHL holds the opportunity in Appointment Booked; the real calendar lives in Modento/DI, and
  the team moves Scheduled → First Appointment Completed → 3-Month Value manually.
- Patient Prism also sends general call events (booked / showed / no-show / follow-up) to GHL
  by inbound webhook — separate from the relo cron.
- Still needed before launch: the practice's Google review link and the referral incentive
  amount (both currently blank), and confirmation that an online booking applies a suppression
  tag so booked patients stop receiving "please book" nurtures.
