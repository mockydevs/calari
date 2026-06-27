# Calari Onboarding Intelligence — System Specs

*Draft for review · 2026-06-27 · Owner: Don · Module: `onboarding` (in calari-internal)*

Specification for an onboarding-intelligence agent that turns Fireflies call
transcripts into Asana tasks, Slack summaries, and enriched Google Drive docs —
eliminating the ~20% information loss at client onboarding handoffs.

---

## 1. Goals & non-goals

**Problem.** ~20% of client detail captured on onboarding calls is lost in the handoff;
team members miss critical needs and action items from the initial calls.

**Solution.** An AI agent that ingests each Fireflies call, extracts marketing-expert-level
insight, and automatically distributes it to the systems the team already works in.

**In scope (v1):**
- Ingest Fireflies transcripts in real time.
- AI insight extraction (replaces Fireflies' shallow summary).
- Auto-create Asana tasks in the correct client project.
- Auto-post summaries to the client's internal **and** external Slack channels.
- Enrich the client's Google Drive onboarding doc with call context.

**In scope (later):** a predictive agent that mines accumulated insight to suggest upsells.

**Non-goals:** replacing Fireflies transcription; replacing Zapier folder creation (kept);
a client-facing UI (this is internal automation).

---

## 2. Design principles

1. **Reuse the existing AI core.** This builds on the `builds` AI spine, not a new stack:
   provider-agnostic `_chat()` (model chosen in `AiConfig`), encrypted key storage,
   Celery async, `AiGenerationLog` telemetry, and RAG (`build_reference_context`).
   → *This already satisfies "model-agnostic, large context window": pick a big-context
   model per op in config; no architecture change.*
2. **The app owns the AI + fan-out.** Zapier keeps only dumb plumbing (Drive folder
   creation). Everything touching the AI or a client lives in the app.
3. **Fully automated, with automated guardrails.** No human approval step (per decision).
   Safety is enforced by code, not clicks — see §8.
4. **Idempotent & observable.** Every external action is keyed on the Fireflies call id,
   retried with backoff, and logged. Re-delivery never double-posts.
5. **Identity-first.** Every action resolves through one per-client integration registry
   (§4.1). No guessing which project/channel/folder.

---

## 3. High-level architecture

```
 Fireflies ──webhook──▶  Ingest endpoint ──▶ [Celery] Transcript fetch (GraphQL)
                                                    │
                                                    ▼
                                       Resolve client (IntegrationMap)
                                                    │
                                                    ▼
                                   AI insight pass  (_chat, structured output,
                                   RAG-grounded in client history + Build Library)
                                                    │
                                       persist CallInsight (queryable)
                                                    │
                        ┌───────────────────────────┼───────────────────────────┐
                        ▼                            ▼                            ▼
                  [Celery] Asana            [Celery] Slack ×2          [Celery] Drive
                  create tasks              internal + external        append call context
                        │                            │                            │
                        └──────────── IntegrationEvent log (idempotent, retried) ─┘
```

New Django app: **`onboarding`** (depends on `projects.Clients` and the `builds` AI services).

---

## 4. Data model

### 4.1 `IntegrationMap` (the keystone — one row per client)
Ties a client to its external identities. Anchored on the existing numbering system
(Drive ↔ Asana already align).

| field | purpose |
|---|---|
| `client` (FK → projects.Clients, unique) | the client |
| `client_number` | the shared numbering key (e.g. `017`) |
| `drive_folder_id` | Google Drive client subfolder under `01-clients` |
| `drive_onboarding_doc_id` | the doc to enrich |
| `asana_project_gid` | Asana project to create tasks in |
| `slack_internal_channel_id` | internal channel |
| `slack_external_channel_id` | Slack Connect (client workspace) channel |
| `fireflies_match` | match rule: client domain + known participant emails |
| `active` | gate automation per client |

> **Why this is first:** every fan-out action is "resolve the map, then act." Without it,
> each integration is guesswork.

### 4.2 `Connection` (credentials — generalizes the existing `AiApiKey`)
Encrypted (reuse AES-GCM + scrypt). One row per provider connection.

| field | purpose |
|---|---|
| `provider` | FIREFLIES \| ASANA \| SLACK \| GDRIVE |
| `auth_type` | api_key \| oauth |
| `encrypted_secret` | API key or OAuth access token |
| `encrypted_refresh` | OAuth refresh token (nullable) |
| `scopes`, `expires_at`, `workspace_ref`, `active` | OAuth housekeeping |

Managed in **Settings → Connections** (mirrors the AI Keys page).

### 4.3 `CallInsight` (the AI output — and the upsell seed)
Structured so a later predictive agent can query it. **Design the schema now.**

| field | purpose |
|---|---|
| `client` (FK), `fireflies_call_id` (unique) | identity + dedupe |
| `title`, `call_date`, `participants`, `transcript_url` | provenance |
| `summary` | human-readable headline |
| `insight` (JSON) | structured: `needs[]`, `pain_points[]`, `services_mentioned[]`, `action_items[]`, `sentiment`, `risks[]`, `upsell_signals[]` |
| `confidence` | overall extraction confidence (drives guardrails) |
| `ai_model`, `created_at` | telemetry |

### 4.4 `IntegrationEvent` (audit + idempotency + retraction)
One row per outbound action.

| field | purpose |
|---|---|
| `call_insight` (FK), `target` (ASANA/SLACK_INT/SLACK_EXT/DRIVE) | what + where |
| `dedupe_key` (unique: call_id + target) | prevents double-posting on re-delivery |
| `status` | pending \| sent \| failed \| skipped \| retracted |
| `external_ref` | Asana task gid / Slack ts / Drive revision — enables retraction |
| `attempts`, `error`, `payload_snapshot` | reliability + audit |

---

## 5. The pipeline (sequence)

1. **Webhook in.** Fireflies fires on "transcription ready." Endpoint verifies the
   signing secret, records the call id, returns 200 fast, enqueues a Celery job.
   *(Idempotent: if the call id was seen, no-op.)*
2. **Fetch transcript** via Fireflies GraphQL (full text + participants + metadata).
3. **Resolve client** via `IntegrationMap.fireflies_match` (domain / participant emails).
   No confident match → log `skipped`, alert an internal ops channel, stop.
4. **AI insight pass** — `_chat()` with a structured-output schema (§7), grounded in the
   client's prior `CallInsight` history + Build Library. Persist `CallInsight`.
5. **Guardrail pass** (§8) — if it fails, downgrade to internal-only + ops alert.
6. **Fan out** (parallel Celery tasks, each idempotent via `dedupe_key`):
   - Asana: create tasks from `insight.action_items`.
   - Slack internal: full summary.
   - Slack external: client-appropriate summary (different tone/redaction).
   - Drive: append a "Call context — {date}" section to the onboarding doc.
7. **Log** every action to `IntegrationEvent`.

---

## 6. Integration contracts

### Fireflies
- **Mode:** webhook (real-time) → GraphQL pull for the transcript. *(Not polling.)*
- **Auth:** API key (`Connection` FIREFLIES).
- **Dedupe:** Fireflies call id is the idempotency key throughout.
- **Value:** replaces Fireflies' shallow summary with the deep AI insight.

### Asana
- **Auth:** OAuth or PAT. **Target:** `asana_project_gid` from the map.
- **Action:** one task per `action_item` (title, notes = context, due if inferred).
- **Idempotency:** dedupe_key = `call_id:asana`; store created task gids for retraction.

### Slack
- **Auth:** bot token; bot invited to both channels.
- **Internal:** post to `slack_internal_channel_id` (full detail).
- **External (Slack Connect constraint):** the client's channel lives in **their**
  workspace with a different channel id and different user ids. We do **not** need their
  user ids — we need the **channel id** stored in the map and the bot present in the
  shared channel. External message uses a client-appropriate variant (redact internal
  notes, adjust tone).
- **Idempotency:** dedupe_key per channel; store message `ts` for retraction/threading.

### Google Drive
- **Auth:** service account with access to `01-clients`.
- **Boundary:** Zapier still **creates** folders on onboarding; the app **enriches** the
  existing onboarding doc (append call context). Target: `drive_onboarding_doc_id`.
- **Idempotency:** dedupe_key = `call_id:drive`; one appended section per call.

---

## 7. AI layer

- **Engine:** existing `_chat()` → provider/model from `AiConfig` (use a large-context
  model for transcripts). Telemetry via `AiGenerationLog`.
- **Output:** strict structured schema → `CallInsight.insight` (needs, pain points,
  services mentioned, action items, sentiment, risks, **upsell_signals**).
- **Prompt intent:** "senior marketing/CRM strategist" — extract decisions, commitments,
  and unspoken needs, not just a recap. One action item per discrete commitment.
- **Large transcripts:** if a transcript exceeds the context budget, map-reduce
  (chunk → partial insights → merge pass). Most calls fit one pass.
- **Grounding (RAG):** feed prior `CallInsight`s for the client so insight is cumulative —
  this is what later powers proactive upsell.

---

## 8. Full automation + safety rails (no human gate)

Because client-facing actions post automatically, safety is enforced in code:

1. **Confidence threshold.** `CallInsight.confidence` below a bar → internal-only,
   external posting `skipped`, ops alerted.
2. **Guardrail pass.** A cheap second AI/heuristic check before any *external* send:
   no PII leakage, no internal-only notes, no hallucinated commitments, on-brand tone.
   Fail → internal-only + alert.
3. **Client active flag.** `IntegrationMap.active=false` disables all automation for a
   client (safe onboarding ramp).
4. **Global kill switch.** One setting halts all outbound posting instantly.
5. **Retraction.** `IntegrationEvent.external_ref` lets ops delete/edit a posted Slack
   message, Asana task, or Drive revision in one action.
6. **Rate limits + dedupe.** Per-client/per-channel caps; dedupe_key prevents double-posts.
7. **Full audit.** Every action + payload snapshot logged for review.

---

## 9. Identity resolution (call → client)

Order of resolution against `IntegrationMap.fireflies_match`:
1. Participant email domain matches a client domain.
2. Specific participant email on the client's known-contacts list.
3. Explicit Fireflies meeting title / tag convention (`[017]`).
No confident single match → **do not act**; log `skipped` + ops alert (false attribution
to the wrong client is the worst failure mode here).

---

## 10. Reliability, security, observability

- **Reliability:** Celery retries w/ exponential backoff; dead-letter after N; idempotent
  by dedupe_key; webhook returns fast and defers work.
- **Security:** all tokens encrypted at rest (reuse AES-GCM); webhook signature
  verification; least-privilege scopes; service account scoped to `01-clients`.
- **Observability:** `IntegrationEvent` + `AiGenerationLog` give per-call, per-action
  status, cost, and latency; an internal ops Slack channel for skips/failures/guardrail
  trips.

---

## 11. Phasing

| Phase | Deliverable |
|---|---|
| 1 | `IntegrationMap` + `Connection` (Settings → Connections); identity resolution |
| 2 | Fireflies webhook → AI `CallInsight` → **internal** Slack only |
| 3 | Asana task creation |
| 4 | Drive enrichment + **external** Slack (guardrail pass live) |
| 5 | Insight history → predictive upsell agent |

Each phase is shippable and independently valuable.

---

## 12. Long-term: predictive upsell

The upsell agent is a **data** decision made now: because every call persists a structured
`CallInsight` (incl. `services_mentioned` + `upsell_signals`), a later agent can query a
client's accumulated insight + delivery history and proactively suggest next services.
No new capture work later — just an analysis pass over data we're already storing.

---

## 13. Open questions for review
- Fireflies plan/API tier — confirm webhook + GraphQL transcript access.
- Asana auth: shared PAT vs per-user OAuth?
- Slack: one company bot across all client Connect channels — confirm install path.
- Drive enrichment: append to the existing onboarding doc, or a dedicated "Call log" doc?
- Confidence/guardrail thresholds: who tunes them, and what's the ops-alert channel?
