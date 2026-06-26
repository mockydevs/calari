# GoHighLevel (GHL) API — Source of Truth & Expert Reference

> **This is the canonical reference the team and the AI consult whenever a client
> build needs API work.** GHL ships new features and endpoints constantly —
> **always re-check the official docs below before scoping or quoting API work**;
> treat anything in this file as a snapshot that can go stale.

_Last verified against the official docs: 2026-06-26._

## Official documentation (check these first, every time)

| Resource | URL |
|---|---|
| **API docs (V2 — primary)** | https://marketplace.gohighlevel.com/docs/ |
| **Developer portal** | https://developers.gohighlevel.com/ |
| **Developer support** | https://developers.gohighlevel.com/support |
| **Developer community** | https://developers.gohighlevel.com/join-dev-community |
| **API docs GitHub (issues / changelog)** | https://github.com/GoHighLevel/highlevel-api-docs |
| **Help-center API article** | https://help.gohighlevel.com/support/solutions/articles/48001060529-highlevel-api-documentation |
| **Help center (all solutions)** | https://help.gohighlevel.com/support/solutions |

## Versions (as of last check)

- **V1** — **end-of-support 31 Dec 2025.** Do **not** build new integrations on V1
  Location/Agency API keys; migrate any client still on V1.
- **V2** — current, supported. **OAuth 2.0** (Marketplace apps) or **Private
  Integration Tokens** (single-location internal use).
- **V3** — in development (enhanced capabilities / new endpoints). Watch the
  changelog; do not assume availability yet.

## Base URL

```
https://services.leadconnectorhq.com
```

## Authentication

- **OAuth 2.0** — for public / Marketplace apps and anything multi-location.
  Scoped access tokens; you request only the scopes the integration needs.
- **Private Integration Token** — for internal / single-location automations.
- **Plan gating:** Starter/Unlimited get basic (Location) API access; Agency Pro
  unlocks Agency keys + OAuth 2.0. **Confirm the client's plan early** — it
  determines what's even possible.

## Rate limits (per resource)

- **Burst:** 100 requests / 10 seconds.
- **Daily:** 200,000 requests / day.

Design bulk syncs (imports, nightly ERP/accounting jobs) to stay under burst —
batch + backoff. Flag any client integration that could exceed these.

## Core resource groups (V2)

Verify exact paths/payloads in the docs before implementing — this is the map,
not the territory:

- **Contacts / CRM** (`/contacts/`) — leads & customer data, full CRUD, search.
- **Opportunities & Pipelines** — deals, pipeline stages, stage movement.
- **Calendars & Events** — calendars, availability, appointments/bookings.
- **Conversations / Messaging** — SMS, email, calls; inbound/outbound.
- **Workflows** — trigger/enroll automations.
- **Custom Fields & Custom Values**, **Tags** — the data model a build relies on.
- **Users**, **Locations (sub-accounts)**, **Businesses**.
- **Payments / Invoices / Subscriptions**.
- **Forms / Surveys / Funnels**.
- **Webhooks / Events** — real-time push for **50+ event types** (prefer webhooks
  over polling wherever possible; respects rate limits and is near-real-time).

## How this maps to a Calari build blueprint

The vision blueprint we capture per build maps almost 1:1 onto GHL API objects.
Use this mapping when a captured item implies API work:

| Blueprint section | GHL object / API surface |
|---|---|
| Lead sources | Contacts API + inbound Webhooks; form/funnel submissions |
| Pipeline stages / Stage movement | Opportunities & Pipelines API |
| Calendars (conversion points) | Calendars & Events API; booking webhooks |
| Workflows | Workflows API + triggers |
| Custom fields / values / tags | Custom Fields/Values + Tags APIs |
| External integrations | OAuth scopes + webhooks (in) / outbound API calls (out) |

## When a build needs API work — checklist

1. **Version:** V2 (never new V1). Note any V1 migration needed.
2. **Auth:** OAuth 2.0 (which scopes?) vs Private Integration Token. Plan tier OK?
3. **Direction:** inbound (webhook → us) vs outbound (us → GHL API) vs bidirectional.
4. **Events:** which of the 50+ webhook events do we subscribe to?
5. **Rate limits:** does any sync risk the 100/10s or 200k/day ceiling?
6. **Data objects:** contacts, opportunities, appointments, invoices, payments?

These six questions are exactly the gaps the AI blueprint step should raise when
the meeting notes leave them unanswered (see `backend/builds/services.py`,
`_BLUEPRINT_SYSTEM_PROMPT`).
