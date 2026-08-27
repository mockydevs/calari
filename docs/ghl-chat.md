# GHL Chat

The internal `/chat` workspace keeps conversations private to their owner and
targets one explicitly selected GHL client account. It uses the existing
encrypted client connection and the AI provider selected in **AI configuration**.
The existing Slack and task-verification read-only integrations are unchanged.

## Enable access

1. Connect a client using its GHL private integration token and location ID under
   **Clients**. Prefer a dedicated sub-account token with only the required scopes.
2. Open **GHL Chat → Account access**, select that connected client, and enable it.
3. Select the account in the chat sidebar. Administrators can query enabled
   accounts; other staff need an explicit grant for each account.
4. Grant **Read only** or **Read + confirmed changes** to the relevant staff.
   Portal feature permissions alone do not grant GHL chat access. Revoking a grant
   also blocks that staff member's subsequent polling, exports, and execution.

No staff member, including another administrator, can open someone else's private
conversation through the chat API. Administrators can inspect the separate
account audit trail, which records operation and authorization events.

## Ask questions and export results

Examples:

- “How many new contacts were created from 2026-08-01 through 2026-08-26? Show the
  account timezone and any incomplete results.”
- “Discover the available opportunity search operation, then show open opportunities.”
- “What information can this connection inspect about workflows and forms? What
  would still require a manual implementation test?”
- “Find the available operation for adding a contact tag and prepare the change
  for my confirmation.”

The date-range helper fills a new-contact reporting question. Dates are inclusive
calendar dates in the account timezone, including daylight-saving transitions.
**New contacts are not new opportunities or unique real-world people.** The
assistant should clarify an ambiguous request for “leads.”

New-contact reporting deduplicates stable contact IDs, validates creation dates,
and reconciles retrieved records with the API total. It uses only server-returned
pagination cursors and stops at its bounded page/record budget. Missing scopes,
API errors, omitted records, and incomplete pagination must never become a
confident zero or a complete account total.

Each result can display:

- The answer, API evidence, account context, and completeness limitations.
- A bounded preview of underlying result rows.
- **Export CSV** for all rows actually retrieved, not invented or unseen pages.
- **Export PDF** for the question, account, timezone/date range, answer, evidence,
  and limitations. The companion CSV contains the record-level data.

CSV cells are escaped to prevent spreadsheet formulas from executing. PDF content
is escaped and does not load remote images or execute API-supplied HTML. Export
downloads require the same owner/account authorization as the original query.

## Changes require confirmation

The AI discovers and describes operations using the official GHL catalog. It
cannot submit arbitrary URLs, replace authorization headers, or select another
location. Read/write classification is enforced on the server, not by asking the
AI whether it considers an operation safe.

A proposed change displays the account, operation ID, HTTP method/path, complete
parameters, and approval expiry. The user must choose **Review & confirm →
Confirm & execute**. A separate account execution grant is required for staff.
This applies to writes, deletes, payments and outbound messages. Declining a
proposal executes nothing.

Approval is bound to the exact parameters, account, connection revision and
operation contract. The worker checks these again immediately before execution.
Expired or changed proposals cannot be silently substituted. A lost response to a
write is **unknown**, not a retryable success or failure: inspect GHL and the audit
trail before repeating it.

## Limits and safe fallback

Operation discovery does not prove that the token has every listed scope. The GHL
server remains the authority for individual operation permissions. An absent
endpoint cannot be created by AI: for example, a workflow inventory is not proof
that its trigger/action implementation works correctly.

The portal requires an independently verified single-location grant before
general operation execution. GHL's `list_locations` tool has returned HTTP-style
500 errors with otherwise working private integrations. Unknown, multi-account or
incomplete grant responses must not silently enable broad execution. A restricted
read fallback, when available, is limited to explicitly approved and
location-bound queries; its limitations must be displayed with the result.

## Operations and deployment

The HTTP API enqueues durable database jobs; it does not run AI or GHL calls inside
the request. Celery worker and beat must both be running. The production supervisor
already starts both services. Jobs remain visible as queued while a worker is
unavailable. Do not repeatedly submit the same prompt to work around a stopped
worker.

For the isolated local environment, run a separate worker from `backend/`:

```bash
python manage.py run_ghl_chat --settings=config.settings_local
```

Use `--once` to process one pending run during a smoke test. The command refuses
production settings; production continues to use Celery worker and beat.

Apply migrations before serving the new application code. Install the PDF
dependency declared in the backend Dockerfile/CI setup (ReportLab); it does not
require the Windows native libraries used by WeasyPrint.

For local Next.js development outside Docker, point `DJANGO_API_URL` to the local
backend (for example, `http://127.0.0.1:8000`); the Docker hostname `backend` is not
normally resolvable on the host. Keep production credentials out of test fixtures
and use `config.settings_local` for isolated database tests.

## Sources

- [GHL MCP catalog and authentication](https://marketplace.gohighlevel.com/docs/other/mcp/)
- [Private integrations](https://marketplace.gohighlevel.com/docs/Authorization/PrivateIntegrationsToken/index.html)
- [Contact search](https://marketplace.gohighlevel.com/docs/ghl/contacts/search-contacts-advanced/)
