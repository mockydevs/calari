# Handover system — content generation & the learning loop

This folder holds the **gold-standard reference material** behind Calari's AI build system:
how raw client meeting notes become a complete, ready-to-build system blueprint and a
client-facing handover — and how the system *learns* from builds we've already shipped.

## How the two halves work

**1. Content generation (notes → blueprint → handover).**
`backend/builds/services.py::generate_blueprint_draft()` sends the client notes to the
configured model under `_BLUEPRINT_SYSTEM_PROMPT` and returns JSON matching
`_BLUEPRINT_SCHEMA` — lead sources, pipeline stages, stage transitions, calendars, external
integrations, workflows (named with our `A / IN / REC / E,K / G / H,X,Y,Z` code convention),
custom fields/values, tags, pre-launch items, tasks, and **gaps** (the questions an expert
would ask back). `render_handover_markdown()` then renders the persisted blueprint as the
client handover document — the handover is a *view of captured structure*, not hand-written.

**2. The learning loop (how Calari builds).**
`build_reference_context()` pulls excerpts from the **Build Library** — `BuildKnowledge` rows
with `use_for_ai=True` — and injects them into generation as *"how Calari has built similar
systems."* It prefers same-client docs, then general ones (capped at ~8k chars), and within
each group it now **relevance-ranks** docs by token overlap with the build being generated
(its title / goals / integrations) via the pure, unit-testable `relevance_score()`. That way a
hiring build pulls the recruitment reference and a med-spa build pulls the SMS-compliance
playbook, instead of just whichever docs are newest — so the library can grow without burying
the references that actually match. **An empty library means the model has nothing to learn
from**, so seeding it with strong references is the highest-leverage improvement available.

```
client notes ─┐
              ├─► generate_blueprint_draft() ─► blueprint (JSON) ─► render_handover_markdown() ─► handover.md
Build Library ─┘ (use_for_ai=True, via build_reference_context)
   ▲
   └── seeded by:  python manage.py seed_build_library
```

## What's in `examples/`

A complete, **redacted** worked example modeled on a real Calari dental build (Patient Prism
relo sync + Modento online booking + GoHighLevel). All client names, emails, phone numbers,
GHL location IDs, webhook URLs and secrets are replaced with placeholders.

| File | Role in the pipeline |
|---|---|
| `dental-patient-acquisition.notes.md` | **Input** — the kind of kickoff + follow-up meeting notes the generator receives. |
| `dental-patient-acquisition.blueprint.json` | **Expected output** — a full blueprint that validates against `_BLUEPRINT_SCHEMA`. Use it as a generation target and as a regression/eval fixture. |
| `dental-patient-acquisition.handover.md` | **Rendered handover** — what `render_handover_markdown()` produces from that blueprint. |
| `calari-build-patterns.md` | **Cross-vertical playbook** distilled from the wider portfolio (dental, med-spa, recruitment, home services, auto, events, app integrations): the workflows, integrations, reporting pipelines, and the **A2P / SMS-compliance** workstream an expert always includes. Teaches patterns rather than one client's build. |

Both examples are the source text for the seed command below, so the running system learns
from them. The patterns in the playbook are also baked into `_BLUEPRINT_SYSTEM_PROMPT` (see the
prompt snapshot) so the generator proposes them even before the library is populated.

## Two generation outputs: blueprint vs build document

There are now **two** things the system can generate from the same captured build:

1. **Handover** (`render_handover_markdown`) — a *view of the structured blueprint*. Fast, no AI
   call. The client-facing "what we built / how it operates" document.
2. **Build document** (`generate_build_document`) — a long-form, **step-by-step implementation
   guide for the assigned builder**: the 24-section format (goals → architecture → pipeline →
   forms → automations → dashboards → ad tracking → testing/launch → timeline → client assets)
   with **every workflow expanded into GHL builder-level steps** (exact trigger, filters,
   actions, wait steps, if/else branches, stage moves, tags added/removed, notifications, stop
   conditions, success metric) and per-stage operating notes. One AI call on the smartest model,
   grounded in the blueprint + original notes + the Build-Library learning loop.

`examples/events-dj-build-document.md` is a redacted gold example of output (2) — the kind of
document a team member receives (with the original meeting notes) to go and build.

**Generate it:**

```bash
# CLI — writes the doc (and optionally the original notes) to hand to a team member
python manage.py generate_build_doc <build_id> --out build-doc.md --with-notes
```

```http
GET /api/builds/<id>/build-document/      # returns {"markdown": "..."}
```

The GET action makes one AI call (10–30s); for the product UI, consider moving it to an async
task + persisted field (mirroring `generate_build_brief`) as a follow-up.

## What's in `prompts/`

`blueprint-system-prompt.md` is a human-readable snapshot of the live
`_BLUEPRINT_SYSTEM_PROMPT` (the source of truth stays in `services.py`). Keep it here so prompt
changes are reviewable in PRs and the design intent is documented next to the example it
produces.

## Seed the Build Library

```bash
cd backend
python manage.py seed_build_library          # idempotent; safe to re-run
python manage.py seed_build_library --force   # overwrite the reference doc's text
```

This loads **two** general library docs into `BuildKnowledge` (`use_for_ai=True`, not tied to a
client) — the dental reference build and the cross-vertical patterns playbook — so every future
blueprint generation can reference them. Re-running is idempotent (matched by title); `--force`
refreshes the stored text.

## Validate the example against the live schema

```bash
python - <<'PY'
import json
src = open("backend/builds/services.py").read()
region = src[src.index("def _str()"):src.index("_BLUEPRINT_SYSTEM_PROMPT")]
ns = {}; exec(region, ns)
from jsonschema import Draft202012Validator        # pip install "jsonschema>=4.18"
data = json.load(open("docs/handover-system/examples/dental-patient-acquisition.blueprint.json"))
errs = list(Draft202012Validator(ns["_BLUEPRINT_SCHEMA"]).iter_errors(data))
print("VALID" if not errs else [list(e.path) for e in errs])
PY
```

## Redaction policy

Anything committed here is anonymized: no real client names, staff emails, phone numbers, GHL
location IDs, webhook URLs, or integration secrets. Tool/platform names (GHL, Patient Prism,
Modento, Dental Intelligence, Meta CAPI, GTM) are kept because they're the stack, not PII.
