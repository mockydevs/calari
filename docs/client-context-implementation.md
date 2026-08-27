# Client context implementation

## Delivered

Slack routing still delivers the original message and task first. A separate durable database queue enriches the whole thread once, with a category-specific brief for each task. There is no Clare review gate. Staff see Original, GHL evidence, Suggested work, and Reply draft on the task. Replies can be edited, saved, marked ready and copied; none of these actions sends a Slack message.

The worker collects only the mapped client's build requirements, meeting notes (including attached Fathom notes), tasks, captured Slack thread and GHL configuration. It does not use the global knowledge/embedding index. The model receives normalized evidence, never integration tokens or an unrestricted tool executor. Observations cite evidence keys; hypotheses, actions, acceptance checks and missing information are separate.

One shared investigation exists per client/thread. A client lease prevents overlapping investigations across that client's channels. Revisions fence edits, ownership changes, policy changes and credential changes. Follow-up messages preserve staff task fields and edited drafts, but reset readiness and flag drafts for review. Withdrawn sources and revoked access clear derived evidence and drafts.

## GHL coverage and honest limits

The server uses each client's encrypted private integration token and location ID. The live original MCP endpoint was tested with First City Dental, including actual `tools/list` and read calls. The broader Claude-specific v2 endpoint was inspected for capabilities only; no generic `execute_operation` is exposed.

| Area | Adapter | Evidence |
| --- | --- | --- |
| Location | REST | Exact location identity |
| Pipelines | MCP, REST if tool absent | IDs, names, stages |
| Custom fields | MCP, REST if tool absent | IDs, names, data types |
| Tags | REST | IDs and names |
| Forms | REST | IDs and names |
| Workflows | REST | IDs, names, published status when exposed |
| Exact contact | REST, client opt-in | Exact identity/location and tags only |

No broad contact search, clinical details, conversations, payment records, workflow execution, form submissions, or writes are enabled. An exact contact ID must be supplied by staff, and the returned record must match the mapped location before any fields reach the model or UI. First City Dental record reads remain disabled.

Completion checks use the same configuration adapter with fresh reads. Staff can define up to eight exact resource/field criteria. Outcomes distinguish `passed_check`, `failed_check`, `needs_evidence`, and `unavailable`. Resource presence or a matching field is not end-to-end verification. Missing resources in bounded lists never establish absence. Model output cannot award a passed check.

## Access, performance and retention

- Evidence, reply drafts and acceptance endpoints require the assigned staff member or an administrator, even when the parent build is visible to other staff.
- Default context retention is 30 days, configurable to 1–90 days per client. An hourly job removes expired captured Slack copies, interpretations, evidence and drafts. Existing portal meeting notes retain their own lifecycle.
- Editing/deleting a captured Slack message removes prior derived context immediately, even when intake is paused. Message identity tombstones prevent redelivery from restoring deleted content.
- Every channel starts with additional context disabled. Admins explicitly authorize redistribution of channel and client context to assigned staff. Slack app visibility and workspace approval cannot be bypassed.
- Investigation budget: 45 seconds, at most eight GHL data reads, 50 configuration rows per area, 30 captured messages, two 30-message remote thread pages and at most 20 search results. Incomplete coverage is visible. Protocol handshakes are additional requests.
- Configuration cache: five minutes, keyed by client and credential revision. Completion reads bypass it. Contact state and Slack history are not cached. Evidence includes its retrieval timestamp.
- Queue cap: 500 pending/processing investigations; originals still route when context capacity is reached. Drain batches are limited to five. Refresh/capability requests are throttled. Abandoned leases recover with a visible retry state.
- No network calls run on task-list navigation or the task-completion request. Client context loads on expansion and generation is an explicit queued/background action.
- AI uses the configured OpenAI or Anthropic provider. Investigation/draft operations do not silently fail over to another provider. Draft generation receives only scrubbed client messages, not internal meeting notes or staff briefs. Staff must review drafts; filtering is not a guarantee that all sensitive wording can be detected.

## Run locally

Use **only** `config.settings_local` for local migrations and commands. The default settings can target the live database.

```powershell
../.venv/Scripts/python.exe manage.py migrate --settings=config.settings_local
../.venv/Scripts/python.exe manage.py run_client_context --settings=config.settings_local
../.venv/Scripts/python.exe manage.py run_ghl_checks --settings=config.settings_local
```

Production uses Celery beat tasks `onboarding.tasks.drain_client_investigations` every 15 seconds and `onboarding.tasks.purge_client_context` hourly, alongside the existing intake and completion-check workers. Start one beat scheduler and normal workers; do not run the local polling commands against production.

New migrations: `onboarding.0005`, `onboarding.0006` and `builds.0025`. They are additive. Apply the preceding cumulative migrations deliberately after backups; earlier client-portal/global-MCP removal migrations have their own destructive changes. Nothing in this implementation was deployed or migrated against production.

## Final live Slack integration — intentionally pending

1. Use an approved internal or Marketplace Slack app. Enable its MCP server access. Configure the fixed `SLACK_APP_ID`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and `SLACK_CONTEXT_REDIRECT_URI` on the backend. A suitable production callback is `https://backend.calari.tech/api/onboarding/slack/context/callback/`.
2. Configure the workspace ID, Clare's user ID, signing secret, channel mappings and category owners. Subscribe to channel/private-channel messages and the relevant app/token revocation events. No DM subscriptions or `chat:write` scope are required by this workflow.
3. Use **Settings → Slack → Connect Slack context**. This is a separate user OAuth grant, not the legacy posting bot. It uses PKCE and one-use, expiring database state, encrypted access/refresh tokens, and checks the returned user and workspace. Connecting context does not enable intake.
4. Request `search:read.public`, `search:read.private`, `channels:history`, and `groups:history`. Keep private-channel scope only if those channels are authorized for this workflow. Do not give portal staff Slack access as a prerequisite.
5. Verify the actual Slack MCP tool catalogue and search response schema with that grant. The search adapter currently accepts only the reviewed `slack_search_messages(query)` shape and rejects unknown/changed schemas. **This name/schema has not been verified against the user's live Slack grant and may need adjustment during this final connection step.** Thread context has a bounded `conversations.replies` read adapter; missing history/scopes are reported instead of fabricated.
6. Authorize additional context on one pilot channel, confirm access/redistribution with the workspace owner, test a Clare mention and a follow-up, then enable intake. Check split ownership, original text, citations, editable drafts and portal-only notifications. Confirm no Slack send or GHL write occurred.

The research connector is not this application connection. The live workspace was not connected or activated during development.

## Verification

Backend tests cover shared routing, source edits/deletions, duplicate work, client/assignee boundaries, lease fencing, credential rotation, retention, draft conflicts, preserved edits, rejected invented citations, OAuth replay, MCP allowlists/redirects, cross-location results, contact opt-in and deterministic acceptance outcomes. Existing suites and frontend lint, types, dead-code checks, tests and production build are included.

Final checks: 133 backend tests and 39 frontend tests passed; frontend lint, type checking, dead-code analysis and production build passed; migrations have no drift and `git diff --check` is clean.

Local smoke tests use synthetic Slack messages, real First City Dental **configuration-only** reads and the configured AI. Synthetic tasks are labelled as local pilots. No claim is made that live Slack delivery, production PostgreSQL concurrency, production load, or end-to-end GHL workflow behavior has been validated.

The actual local HTTP smoke test verified a 36 ms queue request and a 34 ms completion request, preserved an edited reply across regeneration, and passed an exact workflow-ID existence criterion. Those timings are local observations, not production latency guarantees. Detailed smoke reports are in ignored `.local-checks/` files, not committed client data.

Sources: [HighLevel MCP documentation](https://marketplace.gohighlevel.com/docs/other/mcp/), [Slack MCP documentation](https://docs.slack.dev/ai/slack-mcp-server/), [Slack user OAuth](https://docs.slack.dev/reference/methods/oauth.v2.user.access/).
