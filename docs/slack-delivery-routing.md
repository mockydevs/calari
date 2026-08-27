# Private Slack delivery routing

## Operating model

Clare is Kaizen's contact. Her staff work only in Calari. Configure each selected Slack channel against an internal client account, then give each category one point person. For example, Checkpilot automation/pipelines/tags → Don; forms/funnels → Anita. Names and IDs are configured, never inferred by AI.

There is **no Clare approval gate**. Staff receive the exact captured Slack message and a separately labelled AI interpretation. AI is advisory; staff use their existing build knowledge. This implementation makes no Slack write calls and never exports staff names, assignments, internal responses or notifications to Slack.

## Delivery behavior

- A message explicitly mentioning the configured Clare member ID starts capture in an active mapped channel. Replies in that captured thread are ingested without another mention. Other channel conversations are not saved.
- AI classifies actionable tasks, questions and updates into the existing task categories. Confident acknowledgements and non-actionable conversation create no task.
- Clear categories route to their configured owner. Multiple categories create separate task responsibilities, with one portal notification per person per event.
- An open task for the same channel/thread/category receives subsequent context. Existing manual assignment, task description, status, deadline, priority and internal response are preserved. Follow-ups after completion create a new task; they do not reopen the old one.
- Uncertain interpretation, missing context, unmapped categories or AI failure forward the original to the active staff assigned to that channel, once per person, as team triage. They do not enter a manager approval queue.
- If there are no active staff mappings, the durable event stays in **Routing setup needed**. An administrator must fix the mapping and retry. No system can notify a point person before one exists.
- Original messages and interpretation load on demand in **Tasks → Slack context**, newest first, 20 messages per page. Staff can save an internal response/progress note; it is not sent to Slack.

The original message is rendered as plain text, preserving Slack member/channel IDs and formatting tokens. It is not a Slack-rendered rich message. File attachments are not downloaded or analyzed.

## Privacy and permissions

- Settings, mappings and the global delivery feed require administrator permission.
- Assigned staff access sources only through their own task endpoint. Task managers retain their existing global task access.
- Slack tasks are standalone internal tasks because GHL build tasks currently have broader staff read access. The account is retained in the channel mapping and task title; Slack tasks are not nested in a GHL build or exposed through a public portal.
- Captured text is sent to the portal's configured AI provider. Enable only for channels whose conversation content may be copied into Calari and processed by that provider. This is distinct from the research Slack connector used in Codex.
- Signing secrets are encrypted and write-only. The relay forwards only signature headers and raw bytes, never browser cookies or credentials. The handler verifies Slack's HMAC and a five-minute timestamp window before parsing. See [Slack signature verification](https://docs.slack.dev/authentication/verifying-requests-from-slack/).
- This intake cannot reply to Slack. The older onboarding pipeline is separate: new AutomationSettings rows now default external posting to false, but existing settings are preserved and must be audited before production activation.

## Activate after deployment

1. Deploy frontend and backend together and apply migrations. Run the existing Celery worker **and beat**. A beat entry drains the durable inbox every 15 seconds; actual latency depends on backlog and AI response time.
2. Use an authorized Slack app. The app and its permissions can be visible to Kaizen workspace administrators; this implementation does not hide installation or bypass workspace approval.
3. Configure message subscriptions for the selected channel types (`message.channels` and, if needed, `message.groups`) and corresponding history scopes (`channels:history`, `groups:history`). The app must have access to each selected channel. `app_mention` means mentioning the app, not Clare, and does not satisfy this workflow. [Slack Events API](https://docs.slack.dev/apis/events-api/), [message event reference](https://docs.slack.dev/reference/events/message/).
4. In `/settings/slack`, save the workspace ID, Clare's member ID and the app signing secret. Keep intake paused initially. A signed URL-verification challenge works while paused.
5. Set the app's Events request URL to `https://<portal-domain>/api/webhooks/slack`.
6. Map a channel to an account, assign all relevant responsibilities, then resume that channel. Confirm authorized staff can see its originals. Enable intake and test with one non-sensitive, real message mentioning Clare.
7. Confirm task ownership, original/interpretation separation, an untagged thread reply, notification delivery and duplicate handling before adding channels. Test actual provider interpretation with representative messages; automated tests use mocked AI.

The existing OAuth connect flow was not expanded or reinstalled automatically. Configure event permissions in the authorized Slack app; its existing posting-only scopes are not enough for message intake. No real credentials or live channel mappings were installed by this change.

## Reliability and limits

The webhook performs only bounded validation and durable database ingestion, never AI or Redis publishing. Signed payloads are limited to 256 KiB; message text to 40,000 characters. Event IDs and channel/message timestamps deduplicate delivery. Worker channel leases serialize processing without holding DB transactions during AI calls. Lease tokens fence late workers; task/message/notification writes commit atomically. A worker crash leaves the event queued for a later drain.

AI sees the current message (up to 16,000 characters), up to 12 prior captured messages (1,000 characters each), and up to 20 linked task titles/statuses. Truncation forces staff triage, with the complete original still available. Each AI provider attempt has a 30-second timeout with SDK retries disabled; the existing provider fallback can make a second attempt. Existing daily token limits apply. Slack-provider errors are redacted in AI telemetry.

No history backfill, message edits/deletions, DMs, bot messages, attachment analysis, automatic client replies or recording-to-Slack correlation is implemented. Messages before the first captured mention are unavailable; missing thread roots are labelled for staff triage. Closed tasks and new work in an existing thread are not semantically merged beyond the channel/thread/category rule.

PostgreSQL concurrency, real Slack delivery, production queue load and real AI classification quality require staging verification. No raw-message retention/purge policy is implemented yet; agree one before broad rollout. The local demo uses fictional messages and simulated interpretation, with intake and its channel paused afterward.

## Verification

- Backend coverage: signed/invalid/expired requests, workspace/channel boundaries, no-AI webhook, deduplication, responsibility splits, untagged replies, manual-owner preservation, completed tasks, ambiguous/missing-category/AI-failure fallback, inactive owners, no-owner setup errors, lease and pause fencing, rollback, raw-source permissions, pagination/query counts, bounded AI context.
- Frontend checks: signed-byte relay, no credential forwarding, payload limits, challenge/error propagation, lint, TypeScript, unused-code scan and production build.
- Local HTTP smoke: three fictional deliveries through Next → Django → SQLite with simulated AI, two assigned tasks, thread follow-ups, repeat-delivery deduplication, and temporary secret cleanup.

## Client portal retirement

The unused client-facing `/portal/[token]` page, sharing controls, token-creation action, anonymous build/feedback endpoints, token fields and feedback model were removed. `builds.0021_remove_client_portal` copies existing feedback into internal build activity, retaining its original date, name and text, before deleting the old table. Client records and internal builds remain intact. Existing links cease working after deployment. Back up production before applying this migration; rolling back code/schema does not restore old share tokens or reconstruct feedback rows.
