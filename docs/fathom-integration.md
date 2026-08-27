# Fathom meeting imports

## What is implemented

Fathom's completed-meeting webhook can copy the summary, transcript, suggested action items, meeting date, and recording link into Calari. Admin setup and the inbox live at **Integrations → Fathom** (`/settings/fathom`), also linked from GHL delivery.

An active rule maps an exact participant email to a GHL build. Matching ignores email case. Multiple participants may match the same build; different matched builds are treated as ambiguous. Unmatched/ambiguous meetings remain in the admin-only inbox for preview and manual attachment. General meetings can stay in this inbox; legacy Projects are not yet destinations because the existing meeting-note workflow belongs to GHL builds.

Attached meetings become ordinary `MeetingNote` records with source `fathom`, a visible source label, and an activity entry. Use the existing Meeting Tasklist review/generation flow afterward. Importing does **not** generate or assign staff tasks, send Slack messages, or publish client-facing content automatically. Fathom's summary and suggested actions are labelled as AI-generated/requiring review; the transcript is retained separately in the imported text.

## Activate after deployment

1. Deploy both applications, including onboarding migration `0003`. Keep the backend's existing `API_KEY_ENCRYPTION_SECRET` stable and securely configured.
2. Open Calari's Fathom page on its **public HTTPS domain**. Copy the displayed destination, `https://YOUR_PORTAL_DOMAIN/api/webhooks/fathom`. The localhost preview cannot receive deliveries from Fathom.
3. In [Fathom settings](https://fathom.video/customize), open API Access, generate an API key, then Manage → Add Webhook. Set the destination, select the recordings you want copied into Calari, and include transcript, summary, and action items. See the [official webhook setup guide](https://developers.fathom.ai/webhooks).
4. Copy the webhook signing secret (`whsec_…`) into **Calari's setup form**, then enable imports. Calari does not need your Fathom API key for this webhook-only integration. Do not paste either credential into chat or commit it to the repository.
5. Add routing rules using client-contact emails, not staff attendees shared across clients. Rules apply to future deliveries; route existing inbox items manually. If several builds need the same contact, omit a rule and choose the destination from the inbox.
6. Record a short consented test meeting. Check that it appears once and under the correct build, with transcript, date, summary, and suggested actions intact. Refresh the inbox to see new deliveries.

Choose Fathom's recording scope deliberately. Unmatched meetings are visible only to managers. Attached notes inherit the portal's existing build-access rules; importing does not introduce a new confidential-meeting ACL. This integration does not backfill historical recordings or synchronize later edits from Fathom.

## Reliability and security

- The public Next relay forwards raw signed bytes and only Fathom signature headers, not browser cookies or authorization. It has a 2 MiB body limit and a 15-second upstream deadline. Django also enforces the body limit.
- Django verifies HMAC-SHA256 using the webhook ID, timestamp, and exact raw body, with constant-time signature comparisons and a five-minute timestamp window. Verification is required even in local development. Signing secrets are encrypted using the existing credential encryption and are never returned by the API.
- Recording IDs have a database uniqueness constraint. A redelivery, even with a new message ID, cannot create another note. Once attached or ignored, a recording is not reimported automatically. Deleting its note does not reset deduplication.
- Inbox insertion and automatic attachment commit atomically. Failed saves are not acknowledged as successful. No network/AI/queue calls occur inside the webhook handler; Redis availability is not required for ingestion.
- Inbox pages contain 20 metadata records, not full transcripts. Preview fetches content only on demand. Routing lookups use indexed email fields, and list serialization avoids loading full build documents or note bodies.
- Pausing imports rejects deliveries with 503. Do not rely on indefinite provider retries: verify/replay missed meetings after an extended pause. Existing rules and stored notes remain unchanged.
- Review retention requirements for stored transcripts and restrict endpoint traffic/body sizes at the public proxy. This pass does not add a retention purge or a separate per-recording privacy model.

## Verification and current status

- 58 backend tests passed on isolated SQLite, including 17 Fathom cases for signatures, freshness, raw-body tampering, duplicates, routing ambiguity, atomic rollback, permissions, secret handling, and paginated metadata.
- 32 frontend tests passed, including public webhook routing, exact byte/header forwarding, oversized payload rejection, and non-success propagation.
- Lint with zero warnings, TypeScript, Knip, migration drift checks, and the production build passed.
- Signed fictional payloads were sent through the **local Next endpoint → Django → SQLite**. Automatic matching, duplicate rejection, inbox preview, and manual attachment were verified. Two clearly labelled demo meetings remain in the local preview; the test signing secret and temporary routing rule were removed and imports are paused.

No Fathom account was connected and nothing was deployed. A real provider delivery, PostgreSQL concurrency test, and staging/Docker deployment remain required before production activation.
