# GHL chat backend

This app contains reusable account-scoped chat, a durable worker queue, operation
discovery, approval receipts and private CSV/PDF exports. No demo account, secret,
integration or privileged authentication is enabled by this app.

## Running

Apply both migrations, then run the normal Django API, Celery worker and Celery
Beat. Beat schedules `ghl_chat.tasks.drain_chat` every five seconds. HTTP requests
only insert queue rows; they never call AI/GHL, enqueue an eager Celery task, or
render exports. A stopped worker leaves queued requests durable. Interrupted
mutations are marked `unknown` and are never automatically replayed.

The configured OpenAI/Anthropic provider and shared token ceiling are used. Chat
does not silently fall back to another provider, and disables SDK retries. PDF
uses ReportLab, installed by Docker/CI independently of the hash-pinned
requirements export; local installations need `reportlab>=4.4,<5`. It does not
need WeasyPrint's native Windows libraries. CSV/PDF artifacts live in the
dedicated application database, protected by the same ownership/grant checks as
conversation reads. Database backups therefore contain confidential reports.

Run tests with `python manage.py test Auth builds onboarding projects a2p ghl_chat`.
For isolated Windows development add `--settings=config.settings_local`.

## API contract

Backend routes are under `/api/ghl-chat/`; the frontend proxy uses
`/api/portal/ghl-chat/`.

- `GET/POST accounts/`: accessible accounts; managers can enable an existing
  connected client with `client_id`. Manager GET also returns connections/staff.
- `GET/POST accounts/{id}/grants/`: manager-only response
  `{grants:[{user_id,name,can_execute}]}`. POST accepts `user_id`, `can_execute`
  and optional `revoke`, with strict boolean permission flags.
- `GET/POST conversations/`: only the caller's conversations. POST accepts
  `account_id` and optional `title`.
- `GET conversations/{uuid}/?page=1`: newest 25 runs in chronological order;
  `page`, `run_count`, `has_more` describe older pages. Pages 2-4 load older runs.
- `POST conversations/{uuid}/messages/`: `question` plus client-generated UUID
  `request_key`. Repeating that key returns the same run. The request must not
  change its question. Maximum 100 turns, one pending run per conversation and
  three active jobs per staff member.
- `GET runs/{uuid}/`: status, question, answer, plan, proposal, evidence,
  limitations, account snapshot, timestamps, first 100 `rows`, full retrieved
  `row_count`, `rows_truncated`, and existing artifact URLs only. Polling defers
  full rows and artifact blobs; previews/availability are saved by the worker.
- `POST runs/{uuid}/confirm/`: `decision` (`approve`/`reject`) and exact
  `proposal_hash`. A proposal expires after 15 minutes, including time in queue.
- `GET runs/{uuid}/export/csv/` or `pdf/`: authenticated private attachment;
  unavailable artifacts return 409 and have no URL in run responses.
- `GET accounts/{id}/audit/`: manager-only latest 200 events.

Account grants never expose other staff members' conversations. Read grants
cannot approve mutations. Disabled clients/accounts, removed staff, revoked
grants, changed operation contracts and rotated connections are rechecked by the
worker. A mutation's durable account/operation/parameter fingerprint prevents
duplicate execution even under a new request key. Identical mutations remain
blocked until an administrator investigates their audit and external outcome;
there is deliberately no automatic retry or override endpoint.

## Live compatibility and safety limits

The MCP v2 catalogue must expose `search_operations`, `describe_operation`,
`execute_operation` and `list_locations`. Discovery does not prove an operation
was executed. The server validates metadata/parameters and explicit success
envelopes. It does not use AI-suggested URLs or allow credential/header overrides.
Existing Slack/context read-only allowlists are unchanged.

Full dynamic execution requires a complete, matching, single-location listing.
Agency/global operations remain disabled. Private Integration Tokens can exist at
agency or sub-account level; a `pit-` prefix plus a successful location identity
read does **not** establish single-location scope. See the official explanation:
https://help.gohighlevel.com/support/solutions/articles/155000003054-private-integrations-everything-you-need-to-know

Some PIT connections return `success:false,status:500` for `list_locations` while
other catalogue tools work. If that listing fails, the gateway offers a separate
restricted read policy after REST location identity validation. Only the fixed
`search-contacts-advanced` POST `/contacts/search` operation may run, with forced
location ID, page limit 100, descending creation date, one bounded creation-date
range and server-returned cursors. Every returned row must explicitly match the
selected location. Missing/foreign location IDs fail the report. Generic
operations, record-ID reads and **all mutations** remain blocked. An explicit
multi-location or incomplete successful listing is rejected entirely.
`account_snapshot.restricted_read` and report limitations disclose this mode.

New-contact reports count verified unique contact IDs, not opportunities or
unique people. Dates are inclusive calendar days in the account timezone, with
DST-aware UTC bounds. Only an explicit server-returned `searchAfter` cursor is
used; missing/repeated cursors, excluded records, changing totals or exhausted
limits produce an incomplete count. A failed envelope is never zero. Generic
operation results are explicitly partial and never treated as complete totals.
All data retrieval is bounded by six planning steps, 20 report pages, 2,000
retrieved rows, 2 MB result storage and worker deadlines. Non-empty live
pagination is not asserted as verified by the mocked tests.

CSV contains the full **retrieved** dataset within those bounds; spreadsheet
formula-leading cells are escaped. PDF records question, account, date range,
answer, evidence and limitations. Failed PDF generation preserves the answer and
CSV and reports its failure without inviting another mutation.
