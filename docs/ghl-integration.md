# GoHighLevel client connections

## Setup

Administrators can use **Clients → Add client from GoHighLevel** with a location ID and that sub-account's private integration token. The portal checks the location identity, then creates the client and imports available business name, email, phone, address, website and timezone. Missing contact details stay empty. Existing locations return their existing client; matching emails across different locations require explicit linking rather than automatic merging. Existing portal details are preserved.

For an existing client, use **GHL connection** to save, replace, test or disconnect credentials. Saving alone is not a successful connection test. A changed location requires a token. A blank token preserves the current token. Each location can belong to only one portal client.

Tokens are encrypted with the existing AES-GCM secret configuration, never returned in API payloads or exposed to AI. `reencrypt_secrets` includes GHL connections. Protect database backups and retain old encryption secrets during planned rotations.

Required scopes: `locations.readonly`, `opportunities.readonly`, `locations/tags.readonly`, `forms.readonly`, `workflows.readonly`. See the [official scope reference](https://marketplace.gohighlevel.com/docs/Authorization/Scopes/index.html).

## Read access and limits

The backend uses a fixed HTTPS host, `services.leadconnectorhq.com`, and API version `2021-07-28`. Only GET requests to location identity, pipelines, tags, forms and workflows are implemented. Redirects and automatic retries are disabled. Requests use a 3-second connection timeout, 7-second read timeout, a streaming time check and a 2 MiB response cap. Four inventory reads run concurrently after identity verification. Response location IDs are checked where supplied.

No contacts, patients, form submissions, message histories or workflow executions are fetched or modified. Connection tests store counts and access errors, not inventory names. Names are available transiently to background AI reviews, limited to 50 per area and 120 characters each. Truncated or denied lists do not prove an item is absent. Staff-provided completion notes may be sent to the configured AI provider; do not include patient information in those notes.

Tests reuse the last result for 60 seconds; per-user throttling limits repeated tests. Partial scope failures appear individually. Client list/navigation does not call GHL. Replacing/disconnecting a token invalidates previous test results, and revision checks reject results from an in-flight old connection.

## Staff completion checks

The main **Tasks** workspace and GHL build tasks use `builds.Task`. Saving DONE through their APIs queues a durable completion check; edits to completed task requirements or progress notes queue a fresh check. Reopening invalidates the old result. Legacy `projects.Tasks` boards and standalone meeting checklist rows are not connected to this new worker.

The worker resolves the client through the task's build, or through its Slack intake channel for private Slack assignments. It reads that client's GHL inventory, then asks the configured OpenAI/Claude provider to explain observations, possible gaps and evidence needed. Tokens never reach the model. This is read-only; it does not run test automations, submit forms or send messages.

**Staff status DONE is not a VERIFIED verdict.** Current API inventory does not reveal enough behavior to prove workflow logic, form wiring or a bug-free implementation. Successful reads result in **Needs evidence**, with separate observations and AI interpretation. Missing credentials/access errors remain visible. The code deliberately cannot mark functional work VERIFIED on inventory presence alone. No automatic Clare approval gate is introduced; feedback is a portal notification to the current assignee.

Production uses the existing Celery worker + beat, polling every 15 seconds and processing up to five checks per drain. Work claims and revision checks prevent duplicates and stale results. Interrupted checks become visible failures after five minutes and can be retried from the task. The UI polls only pending checks, with a five-minute limit. Existing DONE tasks are not backfilled or charged automatically; staff can request a check explicitly.

For isolated local testing:

```powershell
cd backend
../.venv/Scripts/python.exe manage.py run_ghl_checks --settings=config.settings_local
# Add --once to drain once and exit.
```

This local command refuses production settings. Do not start an additional worker against production as a testing shortcut.

## API

| Endpoint under `/api/projects/` | Method | Purpose |
| --- | --- | --- |
| `clients/onboard-ghl/` | POST | Verify credentials and onboard from business details |
| `clients/{id}/ghl-connection/` | GET, PUT, DELETE | Admin connection settings, replacement, disconnect |
| `clients/{id}/ghl-test/` | POST | Admin read-access test |

`/api/builds/tasks/{id}/ghl-verification/` supports scoped GET status and POST retry for task owners/managers. Credential operations always require an administrator, even for staff granted general client-management access.

## Deployment

Apply projects migrations `0005`–`0006` and builds migrations `0023`–`0024`, then restart backend, Celery worker/beat and frontend together. Back up the database first. **Builds migration 0023 deletes the obsolete global MCP URL, model and token columns; it cannot restore their former values on rollback.** Credentials are not copied across accounts automatically. Reconnect each location explicitly. Client emails now allow NULL when GHL supplies none; restoring the old non-null schema requires resolving missing-email records.

The AI settings page no longer accepts a GHL server URL, MCP token or separate GHL model. Old `GHL_MCP_*` environment variables are ignored. Progress-report audits use the same per-client read service and disclose inventory limitations.

First City Dental was tested against live GHL through the **local SQLite portal only**. Production migrations, deployment, database writes and Slack activation were not performed. Reports under `.local-checks/` and the local database are Git-ignored.
