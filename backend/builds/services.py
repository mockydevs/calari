"""
Builds — non-CRUD service logic, ported from the Next.js lib/{ai,s3,document-text,
api-keys}.ts. Pure functions; views/tasks call into these.
"""
import base64
import hashlib
import io
import json
import logging
import os
import secrets

from django.conf import settings

logger = logging.getLogger(__name__)

MAX_TEXT_CHARS = 24000
AI_READABLE_EXTENSIONS = {".pdf", ".docx", ".txt", ".csv", ".md", ".rtf"}


# ─── AI provider key crypto (AES-256-GCM + scrypt) ────────────────────────────
_SCRYPT_SALT = b"calari-ai-provider-keys"


def _encryption_key() -> bytes:
    secret = os.getenv("API_KEY_ENCRYPTION_SECRET") or settings.SECRET_KEY
    if not secret:
        raise RuntimeError("API_KEY_ENCRYPTION_SECRET or SECRET_KEY is required to store provider keys")
    return hashlib.scrypt(secret.encode(), salt=_SCRYPT_SALT, n=16384, r=8, p=1, dklen=32, maxmem=64 * 1024 * 1024)


def encrypt_api_key(plaintext: str) -> tuple[str, str]:
    """Returns (encrypted 'iv:tag:ciphertext' base64, preview)."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    iv = secrets.token_bytes(12)
    ct_and_tag = AESGCM(_encryption_key()).encrypt(iv, plaintext.encode(), None)
    ct, tag = ct_and_tag[:-16], ct_and_tag[-16:]
    encrypted = ":".join(base64.b64encode(b).decode() for b in (iv, tag, ct))
    return encrypted, preview_api_key(plaintext)


def decrypt_api_key(encrypted: str) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    parts = encrypted.split(":")
    if len(parts) != 3:
        raise ValueError("Stored API key is malformed")
    iv, tag, ct = (base64.b64decode(p) for p in parts)
    return AESGCM(_encryption_key()).decrypt(iv, ct + tag, None).decode()


def preview_api_key(api_key: str) -> str:
    t = api_key.strip()
    return "********" if len(t) <= 8 else f"{t[:4]}...{t[-4:]}"


def get_active_provider_key(provider: str) -> str | None:
    from .models import AiApiKey

    record = AiApiKey.objects.filter(provider=provider, active=True).order_by("-updated_at").first()
    if record:
        try:
            return decrypt_api_key(record.encrypted_key)
        except Exception:
            pass
    if provider == "OPENAI" and os.getenv("OPENAI_API_KEY"):
        return os.getenv("OPENAI_API_KEY")
    if provider == "ANTHROPIC" and os.getenv("ANTHROPIC_API_KEY"):
        return os.getenv("ANTHROPIC_API_KEY")
    return None


# ─── OpenAI brief generation ──────────────────────────────────────────────────
def _openai_client():
    from openai import OpenAI

    key = get_active_provider_key("OPENAI")
    if not key:
        raise RuntimeError("OpenAI API key is not configured")
    return OpenAI(api_key=key)


# The model is NOT restricted to any specific version. OPENAI_MODEL accepts ANY
# current or future model id — set it to the latest as it releases, no code change
# needed. The smartest model is used for everything (blueprint, QA, SOP). The
# provider + model are chosen in Settings → AI Keys (AiConfig); env vars are the
# fallback. The only hardcoded values are the per-provider defaults + the
# known-good fallback used when the configured model errors.
_SMART_MODEL_DEFAULT = "gpt-4o"        # OpenAI default
_ANTHROPIC_MODEL_DEFAULT = "claude-opus-4-8"  # smartest Claude


def _ai_config():
    """The AiConfig singleton (provider/model chosen in Settings). None if the DB
    isn't reachable — callers then fall back to env."""
    try:
        from .models import AiConfig
        return AiConfig.get_solo()
    except Exception:  # noqa: BLE001
        return None


def _active_provider() -> str:
    cfg = _ai_config()
    if cfg and cfg.provider:
        return cfg.provider
    return os.getenv("AI_PROVIDER", "OPENAI")


def _model() -> str:
    cfg = _ai_config()
    if cfg and cfg.model:
        return cfg.model
    if _active_provider() == "ANTHROPIC":
        return os.getenv("ANTHROPIC_MODEL", _ANTHROPIC_MODEL_DEFAULT)
    return os.getenv("OPENAI_MODEL", _SMART_MODEL_DEFAULT)


def _blueprint_model() -> str:
    """The high-stakes 'expert build-out'. Uses AiConfig.blueprint_model if set,
    else the general model."""
    cfg = _ai_config()
    if cfg and cfg.blueprint_model:
        return cfg.blueprint_model
    return os.getenv("OPENAI_BLUEPRINT_MODEL") or _model()


def _fallback_model() -> str:
    """Known-good OpenAI model retried on if the chosen provider/model errors (typo,
    missing key, not yet on the account). This is what lets you fearlessly switch
    provider/model — a misconfig never hard-fails generation."""
    return os.getenv("OPENAI_FALLBACK_MODEL", _SMART_MODEL_DEFAULT)


def _openai_complete(model, messages, response_format, max_tokens) -> str:
    client = _openai_client()
    kwargs = {"messages": messages}
    if response_format is not None:
        kwargs["response_format"] = response_format
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    completion = client.chat.completions.create(model=model, **kwargs)
    usage = getattr(completion, "usage", None)
    if usage is not None:
        logger.info(
            "AI call provider=OPENAI model=%s prompt_tokens=%s completion_tokens=%s total_tokens=%s",
            model, getattr(usage, "prompt_tokens", None),
            getattr(usage, "completion_tokens", None), getattr(usage, "total_tokens", None),
        )
    return completion.choices[0].message.content


def _anthropic_complete(model, messages, response_format, max_tokens) -> str:
    """Claude path. Structured output (OpenAI-style json_schema) is achieved via a
    forced tool call: the schema becomes the tool's input_schema and we return the
    tool input as a JSON string so callers' json.loads(...) works unchanged."""
    import anthropic

    key = get_active_provider_key("ANTHROPIC")
    if not key:
        raise RuntimeError("Anthropic API key is not configured")
    client = anthropic.Anthropic(api_key=key)

    # Anthropic separates the system prompt from the message list.
    system = "\n\n".join(m["content"] for m in messages if m.get("role") == "system")
    conv = [{"role": m["role"], "content": m["content"]} for m in messages if m.get("role") in ("user", "assistant")]
    if not conv:
        conv = [{"role": "user", "content": ""}]
    kwargs = {"model": model, "max_tokens": max_tokens or 16000, "messages": conv}
    if system:
        kwargs["system"] = system

    if response_format and response_format.get("type") == "json_schema":
        js = response_format["json_schema"]
        name = js.get("name", "result")
        kwargs["tools"] = [{"name": name, "description": "Return the structured result.", "input_schema": js["schema"]}]
        kwargs["tool_choice"] = {"type": "tool", "name": name}
        msg = client.messages.create(**kwargs)
        _log_anthropic_usage(model, msg)
        for block in msg.content:
            if getattr(block, "type", None) == "tool_use":
                return json.dumps(block.input)
        return None
    msg = client.messages.create(**kwargs)
    _log_anthropic_usage(model, msg)
    return "".join(getattr(b, "text", "") for b in msg.content if getattr(b, "type", None) == "text")


def _log_anthropic_usage(model, msg):
    usage = getattr(msg, "usage", None)
    if usage is not None:
        logger.info(
            "AI call provider=ANTHROPIC model=%s input_tokens=%s output_tokens=%s",
            model, getattr(usage, "input_tokens", None), getattr(usage, "output_tokens", None),
        )


def _chat(messages, *, model: str | None = None, response_format=None, max_tokens=None) -> str:
    """One completion call routed to the active provider (OpenAI or Anthropic),
    with a graceful fallback: if the chosen provider/model errors, retry once on the
    known-good OpenAI fallback so a provider/model misconfig never fails a request."""
    provider = _active_provider()
    target = model or _model()

    def _call(prov: str, m: str):
        if prov == "ANTHROPIC":
            return _anthropic_complete(m, messages, response_format, max_tokens)
        return _openai_complete(m, messages, response_format, max_tokens)

    try:
        return _call(provider, target)
    except Exception:  # noqa: BLE001 — APIError/missing key/model-not-found/etc.
        fb = _fallback_model()
        if provider == "OPENAI" and target == fb:
            raise
        return _call("OPENAI", fb)


_BRIEF_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "goals": {"type": "string"},
        "integrations": {"type": "array", "items": {"type": "string"}},
        "contactSources": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "type": {"type": "string", "enum": ["WEBSITE", "ADS", "MANUAL", "OTHER"]},
                    "label": {"type": "string"},
                },
                "required": ["type", "label"],
            },
        },
        "pipelineStages": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "order": {"type": "integer"},
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                    "manualActions": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {"description": {"type": "string"}, "owner": {"type": "string"}},
                            "required": ["description", "owner"],
                        },
                    },
                },
                "required": ["order", "name", "description", "manualActions"],
            },
        },
        "tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "title": {"type": "string"},
                    "type": {"type": "string", "enum": ["AUTOMATION", "FUNNEL", "FORM", "INTEGRATION", "OTHER"]},
                    "description": {"type": "string"},
                },
                "required": ["title", "type", "description"],
            },
        },
    },
    "required": ["goals", "integrations", "contactSources", "pipelineStages", "tasks"],
}

_BRIEF_SYSTEM_PROMPT = (
    "You are a senior solutions architect at an automation agency (Calari Solutions) that builds "
    "client systems in Go High Level (GHL), Zapier, and similar tools.\n"
    "From the client meeting notes you are given, extract a structured build plan:\n"
    "- contactSources: where leads/contacts enter (website forms, paid ads, manual import, etc.)\n"
    "- pipelineStages: the ordered stages a contact moves through, each with a short description and "
    "any manual actions a human must perform at that stage\n"
    "- integrations: the tools/platforms involved\n"
    "- goals: a concise summary of the outcome the client wants\n"
    "- tasks: concrete build tasks for a team member (automations, funnels, forms, integrations)\n"
    "Meeting notes may include the original kickoff plus later follow-up updates. Treat the earliest "
    "notes as the baseline build intent. Treat later notes as change requests, refinements, corrections, "
    "or decisions that supersede earlier details only when they clearly conflict. Preserve original "
    "context that has not been changed.\n"
    "Be specific and practical. If something is not mentioned, infer sensible defaults for an automation "
    "build but keep them minimal. Return only data matching the schema."
)


def generate_brief_draft(notes_text: str, provider: str | None = None) -> dict:
    client = _openai_client()
    completion = client.chat.completions.create(
        model=_model(),
        messages=[
            {"role": "system", "content": _BRIEF_SYSTEM_PROMPT},
            {"role": "user", "content": f"Client meeting notes:\n\n{notes_text[:MAX_TEXT_CHARS]}"},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "build_brief", "strict": True, "schema": _BRIEF_SCHEMA},
        },
    )
    raw = completion.choices[0].message.content
    if not raw:
        raise RuntimeError("AI returned no content")
    return json.loads(raw)


# ─── Vision Blueprint (full client-handover anatomy + gap-seeking) ────────────
def _str(): return {"type": "string"}
def _bool(): return {"type": "boolean"}
def _int(): return {"type": "integer"}
def _enum(*values): return {"type": "string", "enum": list(values)}


def _obj(properties: dict) -> dict:
    """Strict object: every property required, no extras (OpenAI structured-output rules)."""
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": properties,
        "required": list(properties.keys()),
    }


def _arr(items: dict) -> dict:
    return {"type": "array", "items": items}


def _pobj(properties: dict) -> dict:
    """Strict object PLUS provenance fields the reviewer sees: whether the AI
    inferred the item (vs. read it from the notes) and how confident it is."""
    return _obj({
        **properties,
        "inferred": _bool(),
        "confidence": _enum("high", "medium", "low"),
    })


_BLUEPRINT_SCHEMA = _obj({
    "overview": _str(),          # "The big idea" — the single-source-of-truth narrative
    "oneLineSummary": _str(),    # one-sentence summary for the team
    "goals": _str(),
    "integrations": _arr(_str()),
    "maintenanceNotes": _str(),  # services, env vars, cadence — empty if unknown
    "leadSources": _arr(_pobj({
        "type": _enum("WEBSITE", "ADS", "MANUAL", "OTHER"),
        "label": _str(),
        "entryMechanism": _str(),     # how it enters: form trigger, webhook, cron sync…
        "fires": _str(),              # side effects: Meta CAPI, internal alerts, tasks…
        "tagsApplied": _str(),        # comma-separated tags applied on entry
        "handlingWorkflow": _str(),   # workflow code that handles it, e.g. "IN1"
        "entryStage": _str(),         # name of the pipeline stage it lands in
        "notes": _str(),
    })),
    "pipelineStages": _arr(_pobj({
        "order": _int(),
        "name": _str(),
        "description": _str(),        # "what it means"
        "entryCondition": _str(),     # "how a lead gets here"
        "isAutomatic": _bool(),       # advances automatically on a reliable signal
        "manualActions": _arr(_obj({"description": _str(), "owner": _str()})),
    })),
    "stageTransitions": _arr(_obj({
        "fromStage": _str(),          # source stage name ("" if it's an entry)
        "toStage": _str(),            # destination stage name
        "trigger": _str(),            # what causes the move
        "isAutomatic": _bool(),
        "notes": _str(),
    })),
    "calendars": _arr(_pobj({          # booking objects — the conversion point
        "name": _str(),
        "type": _enum("ROUND_ROBIN", "COLLECTIVE", "CLASS", "SERVICE", "PERSONAL", "OTHER"),
        "purpose": _str(),            # what it books: consult, in-person visit, demo…
        "assignedTo": _str(),         # team members / providers
        "booksIntoStage": _str(),     # name of the stage a booking lands in
        "onBooking": _str(),          # what fires on booking (workflow, tags, reminders)
        "reminders": _str(),          # reminder/confirmation cadence
        "notes": _str(),
    })),
    # NOTE: must NOT be named "integrations" — that key is already the simple
    # string list above. A duplicate key silently overwrote it, so the model
    # returned objects under "integrations" and ", ".join(...) crashed in
    # _persist_blueprint. These rich objects feed the Integration model.
    "externalIntegrations": _arr(_pobj({   # external systems wired to GHL (any direction)
        "name": _str(),               # Patient Prism, Modento, QuickBooks, custom ERP…
        "direction": _enum("INBOUND", "OUTBOUND", "BIDIRECTIONAL"),
        "mechanism": _enum("API", "WEBHOOK", "NATIVE", "ZAPIER", "CRON", "OTHER"),
        "dataObjects": _str(),        # contacts, appointments, quotes, invoices, payments…
        "purpose": _str(),
        "triggerCadence": _str(),     # real-time, daily cron, on stage change…
        "notes": _str(),
    })),
    "workflows": _arr(_pobj({
        "code": _str(),               # e.g. "A1", "IN3", "K4"
        "category": _enum(
            "ACTIVE_CONVERSION", "INTAKE_ROUTING", "RECORD_KEEPING",
            "APPOINTMENT_LIFECYCLE", "POST_VISIT", "INTERNAL_UTILITY", "OTHER",
        ),
        "name": _str(),
        "trigger": _str(),
        "whatItDoes": _str(),
        "patientFacing": _bool(),
    })),
    "customFields": _arr(_obj({
        "kind": _enum("FIELD", "VALUE"),
        "key": _str(),
        "description": _str(),
        "populated": _bool(),         # False = still blank / needs a value
    })),
    "tags": _arr(_obj({"tag": _str(), "meaning": _str()})),
    "preLaunchItems": _arr(_obj({"description": _str(), "optional": _bool()})),
    "tasks": _arr(_obj({
        "title": _str(),
        "type": _enum("AUTOMATION", "FUNNEL", "FORM", "INTEGRATION", "OTHER"),
        "description": _str(),
    })),
    # The gap-seeking output: what's missing, and the targeted question to close it.
    "gaps": _arr(_obj({
        "category": _enum(
            "OVERVIEW", "STAGE", "TRANSITION", "LEAD_SOURCE", "CALENDAR",
            "INTEGRATION", "WORKFLOW", "CUSTOM_FIELD", "TAG", "GENERAL",
        ),
        "question": _str(),           # the follow-up to ask the client/team
        "rationale": _str(),          # why it matters to the build
        "severity": _enum("high", "medium", "low"),
    })),
})

_BLUEPRINT_SYSTEM_PROMPT = (
    "You are THE most senior Go High Level (GHL) solutions architect at Calari Solutions — a true "
    "expert who has shipped hundreds of GHL builds and knows the platform (pipelines, workflows, "
    "calendars, custom fields/values, tags, triggers, the V2 API and webhooks) cold.\n\n"
    "Your job: turn client meeting notes into a COMPLETE, READY-TO-BUILD system blueprint — the exact "
    "structure of our end-of-build client handover — so a Calari staff member can IMPLEMENT it in GHL "
    "without going back to the client for the obvious pieces. Think like the architect who designs the "
    "whole system, names every part, and hands the builder a finished plan.\n\n"
    "BUILD IT OUT IN FULL — do not just transcribe the notes:\n"
    "- Design the ENTIRE pipeline and NAME every stage (real GHL stage names, in order).\n"
    "- Design EVERY workflow the system needs and NAME each one with a code prefix per our convention "
    "(A = active conversion, IN = intake/routing, REC = record-keeping, E/K = appointment lifecycle, "
    "G = post-visit, H/X/Y/Z = internal/utility), each with its trigger and what it does. Include the "
    "supporting automations an expert KNOWS a build needs (lead acknowledgement, speed-to-lead, "
    "nurture, no-show/reschedule, reminders, review/referral, internal alerts) even when the notes "
    "don't spell them out.\n"
    "- Trace the COMPLETE movement of a contact END TO END: for every way a contact arrives (each lead "
    "source / funnel / external party), give the entry mechanism, the stage they land in, every stage "
    "transition and its exact trigger, the nurture that drives them to a booking, the conversion "
    "calendar, and what happens after conversion. Leave no contact journey half-drawn.\n"
    "- Specify the custom fields, custom values, and tags the workflows above depend on.\n"
    "When you infer a standard piece the notes didn't state, INCLUDE it (so the build is complete), mark "
    "that item inferred=true with a confidence level, AND record it as a low/medium-severity gap so the "
    "admin can confirm or correct it. Items clearly stated in the notes are inferred=false. Be thorough "
    "and specific over brief — completeness is the whole point.\n\n"
    "PROVENANCE: for every leadSource, pipelineStage, calendar, externalIntegration and workflow, set "
    "`inferred` (true if you supplied it from your expertise rather than the notes) and `confidence` "
    "(high/medium/low) so reviewers know exactly what to scrutinize.\n\n"
    "Extract:\n"
    "- overview: a plain-English 'big idea' — the single source of truth and how leads flow through it\n"
    "- oneLineSummary: a one-sentence summary the delivery team can repeat\n"
    "- goals, integrations: the outcome the client wants and the tools involved\n"
    "- leadSources: every way a contact enters, WITH mechanics — how it enters (form/webhook/cron), "
    "what it fires (e.g. Meta CAPI, internal alert), tags applied, the handling workflow, and which "
    "pipeline stage it lands in\n"
    "- pipelineStages: ordered stages, each with what it means, how a lead gets here, and whether it "
    "advances automatically or needs a manual action (list manual actions and their owner)\n"
    "- stageTransitions: the MOVEMENT between stages — for each, the from/to stage names and the exact "
    "trigger that causes the move (a status change, a tag, a webhook, or a manual team action)\n"
    "- calendars: the booking object(s) where a nurtured lead CONVERTS — this is the point of "
    "conversion in GHL. Capture what each calendar books (a sales call, a demo, or a physical visit "
    "like a dental appointment), its type, who it's assigned to, which pipeline stage a booking lands "
    "in, and what fires on booking (confirmation, reminders, stage move). Nurture sequences exist to "
    "drive a booking on one of these calendars — make that journey explicit.\n"
    "- externalIntegrations: every external system wired to GHL, in ANY direction. INBOUND tools feed contacts "
    "into GHL (e.g. Patient Prism, Modento, a website app, an ERP); OUTBOUND flows push data out of GHL "
    "(to an external database, accounting/ERP, or to generate quotes and invoices); BIDIRECTIONAL syncs "
    "both ways. For each, capture the mechanism (API, webhook, native, Zapier, cron), the data objects "
    "exchanged (contacts, appointments, quotes, invoices, payments), the trigger/cadence, and its purpose\n"
    "- workflows: the automations to build, grouped by category, each with its trigger and what it does\n"
    "- customFields: custom fields and custom values the system needs (mark populated=false if a value "
    "is still missing)\n"
    "- tags: the tag glossary\n"
    "- preLaunchItems: checklist items, decisions, and risks to resolve before go-live\n"
    "- tasks: concrete build tasks for a team member\n\n"
    "GHL API AWARENESS — Calari builds run on Go High Level. GHL exposes a V2 REST API "
    "(base https://services.leadconnectorhq.com, OAuth 2.0 or a Private Integration Token; the "
    "legacy V1 keys reached end-of-support on 31 Dec 2025). Most of this blueprint maps onto GHL API "
    "objects: lead sources → Contacts API + inbound webhooks; stages/transitions → Opportunities & "
    "Pipelines API; calendars → Calendars & Events API; workflows → Workflows API; custom fields/values "
    "and tags → their respective APIs. PREFER webhooks (50+ event types) over polling. When an "
    "integration or workflow plainly needs the API, classify its mechanism accordingly (API / WEBHOOK / "
    "NATIVE / ZAPIER / CRON) and, when the notes leave the API specifics unanswered, RAISE GAPS for: "
    "(a) auth model + OAuth scopes, (b) which webhook events to subscribe to, (c) inbound vs outbound vs "
    "bidirectional direction, (d) data objects exchanged (contacts, opportunities, appointments, "
    "invoices, payments), (e) rate-limit risk for bulk syncs (100 req / 10s burst, 200k / day per "
    "resource), and (f) any client still on V1 that must migrate. Do NOT invent endpoint paths — surface "
    "the unknown as a gap.\n\n"
    "CRITICAL — always seek the structure. The client's notes will be incomplete. For every part of the "
    "blueprint that the notes do not pin down — especially missing stage transitions, lead-source "
    "mechanics, ambiguous stage movement, the conversion calendar(s) the nurture drives toward, and any "
    "external integration whose direction, mechanism, or data flow is unclear — add a 'gaps' entry with a specific, answerable follow-up "
    "question and why it matters. Do NOT silently invent these; surface them as gaps. Only infer a "
    "sensible minimal default when the gap is low-stakes, and still note it as a low-severity gap.\n\n"
    "Meeting notes may include a kickoff plus later updates. Treat the earliest notes as the baseline "
    "intent and later notes as refinements that supersede earlier details only when they clearly "
    "conflict. Preserve unchanged context. Return only data matching the schema."
)


KNOWLEDGE_MAX_CHARS = 8000


def build_reference_context(build) -> str:
    """Gather excerpts from the Build Library (use_for_ai docs) as reference material
    so generation learns from how Calari actually builds. Prefers same-client docs,
    then general ones; capped in count and size."""
    from .models import BuildKnowledge

    qs = BuildKnowledge.objects.filter(use_for_ai=True).exclude(raw_text="")
    docs = list(qs.filter(client_id=build.client_id)[:3]) + list(qs.exclude(client_id=build.client_id)[:2])
    parts, budget = [], KNOWLEDGE_MAX_CHARS
    for d in docs:
        excerpt = (d.summary or d.raw_text or "").strip()[:2500]
        if not excerpt:
            continue
        block = f"### {d.title}\n{excerpt}"
        parts.append(block)
        budget -= len(block)
        if budget <= 0:
            break
    return "\n\n".join(parts)[:KNOWLEDGE_MAX_CHARS]


def generate_blueprint_draft(notes_text: str, reference_text: str = "", resolved_text: str = "") -> dict:
    """Extract the full vision blueprint (handover anatomy) + gaps from meeting notes.

    `reference_text` is Build Library context (how Calari builds — the learning loop);
    `resolved_text` is answered vision-gap Q&A treated as authoritative (the gap loop).
    """
    messages = [{"role": "system", "content": _BLUEPRINT_SYSTEM_PROMPT}]
    if reference_text.strip():
        messages.append({"role": "system", "content": (
            "REFERENCE — how Calari has built similar systems (past builds / client docs from our Build "
            "Library). Use these to match our naming, structure, and conventions; adapt rather than copy "
            "client-specific details that don't apply here:\n\n" + reference_text[:KNOWLEDGE_MAX_CHARS]
        )})
    if resolved_text.strip():
        messages.append({"role": "system", "content": (
            "RESOLVED QUESTIONS — the team has answered these previously-open gaps. Treat them as "
            "AUTHORITATIVE and build them in; do not re-raise them as gaps:\n\n" + resolved_text[:6000]
        )})
    messages.append({"role": "user", "content": f"Client meeting notes:\n\n{notes_text[:MAX_TEXT_CHARS]}"})

    raw = _chat(
        messages,
        model=_blueprint_model(),
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "build_blueprint", "strict": True, "schema": _BLUEPRINT_SCHEMA},
        },
    )
    if not raw:
        raise RuntimeError("AI returned no content")
    return json.loads(raw)


_QA_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "issues": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "area": {"type": "string"},
                    "issue": {"type": "string"},
                    "severity": {"type": "string", "enum": ["high", "medium", "low"]},
                },
                "required": ["area", "issue", "severity"],
            },
        },
        "summary": {"type": "string"},
    },
    "required": ["issues", "summary"],
}


def run_brief_qa(build) -> dict:
    stages = list(build.stages.all())
    sources = list(build.contact_sources.all())
    tasks = list(build.tasks.all())
    brief = "\n".join([
        f"Goals: {build.goals or 'not set'}",
        f"Integrations: {build.integrations or 'none'}",
        f"Contact sources: {', '.join(f'{s.type}:{s.label}' for s in sources) or 'none'}",
        f"Pipeline stages ({len(stages)}): {' → '.join(s.name for s in stages)}",
    ])
    task_lines = "\n".join(
        f"[{t.status}] {t.title} ({t.type}){' [AI]' if t.ai_generated else ''}" for t in tasks
    ) or "none"
    prompt = (
        "You are a QA reviewer for an automation agency build. Compare the brief against the current "
        "task list and flag gaps, missing items, or potential delivery risks.\n\n"
        f"BRIEF:\n{brief}\n\nTASKS ({len(tasks)} total):\n{task_lines}\n\n"
        "Return JSON matching the schema. Be concise and specific. Focus on meaningful gaps — not style nitpicks."
    )
    raw = _chat(
        [{"role": "user", "content": prompt}],
        response_format={"type": "json_schema", "json_schema": {"name": "qa_report", "strict": True, "schema": _QA_SCHEMA}},
    )
    if not raw:
        raise RuntimeError("AI returned no QA content")
    return json.loads(raw)


def generate_task_sop(task) -> str:
    build = task.build
    stages = list(build.stages.all())
    sources = list(build.contact_sources.all())
    context = "\n".join([
        f"Build goals: {build.goals or 'not specified'}",
        f"Integrations: {build.integrations or 'none listed'}",
        f"Pipeline stages: {' → '.join(s.name for s in stages)}",
        f"Contact sources: {', '.join(s.label for s in sources) or 'none'}",
    ])
    prompt = (
        "You are a senior GHL/Zapier solutions architect at Calari Solutions.\n"
        "Write a concise, numbered step-by-step implementation guide (SOP) for the following task.\n"
        "Use platform-specific terms (GHL workflows, triggers, Zapier Zaps, etc.) where appropriate.\n"
        "Be practical and specific — someone who knows GHL should be able to follow this without guessing.\n\n"
        f"Task title: {task.title}\nTask type: {task.type}\nTask description: {task.description or 'no description'}\n\n"
        f"Build context:\n{context}\n\nRespond ONLY with the numbered SOP steps. No intro or outro sentences."
    )
    sop = (_chat([{"role": "user", "content": prompt}], max_tokens=800) or "").strip()
    if not sop:
        raise RuntimeError("AI returned no SOP content")
    return sop


_GAP_SUGGEST_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {"options": {"type": "array", "items": {"type": "string"}}},
    "required": ["options"],
}


def suggest_gap_answers(build, question: str, rationale: str = "") -> list[str]:
    """Propose 2–4 concise, expert best-practice answers to an open vision gap.

    These become click-to-use options in the UI; the team can pick one and edit,
    or type their own.
    """
    stages = list(build.stages.all())
    sources = list(build.contact_sources.all())
    context = "\n".join([
        f"Goals: {build.goals or 'not set'}",
        f"Integrations: {build.integrations or 'none'}",
        f"Pipeline stages: {' → '.join(s.name for s in stages) or 'none'}",
        f"Lead sources: {', '.join(s.label for s in sources) or 'none'}",
    ])
    prompt = (
        "You are a senior Go High Level (GHL) solutions architect at Calari Solutions. A build's vision "
        "blueprint has an OPEN gap — a question that must be resolved before delivery. Propose 2 to 4 "
        "concise, expert ANSWER options the team could adopt as the resolution. Each option must be a "
        "complete, specific answer (NOT another question), grounded in GHL conventions and the build "
        "context. Prefer sensible best-practice defaults; keep each option to 1–2 sentences.\n\n"
        f"GAP QUESTION: {question}\n"
        f"WHY IT MATTERS: {rationale or 'n/a'}\n\n"
        f"BUILD CONTEXT:\n{context}\n\n"
        "Return JSON matching the schema."
    )
    raw = _chat(
        [{"role": "user", "content": prompt}],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "gap_answers", "strict": True, "schema": _GAP_SUGGEST_SCHEMA},
        },
    )
    if not raw:
        return []
    return [o for o in (json.loads(raw).get("options") or []) if isinstance(o, str) and o.strip()][:4]


# ─── Meeting-note naming + progress-update delta ──────────────────────────────
def ordinal(n: int) -> str:
    if 10 <= (n % 100) <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def auto_note_title(build, kind: str) -> str:
    """A human label for a meeting note. Call AFTER the note is saved (it counts
    the note in the ordinal). e.g. 'Kickoff meeting notes', '2nd Meeting notes',
    'Client-requested update', 'Progress update — Jun 27, 2026'."""
    from datetime import date as _date
    if kind == "kickoff":
        return "Kickoff meeting notes"
    if kind == "change_request":
        return "Client-requested update"
    if kind == "progress":
        return f"Progress update — {_date.today():%b %d, %Y}"
    n = build.meeting_notes.count() or 1
    return f"{ordinal(n)} Meeting notes"


def _build_state_summary(build) -> str:
    """Compact snapshot of the current build, for delta comparison."""
    stages = list(build.stages.all())
    workflows = list(build.workflows.all())
    parts = [
        f"Overview: {build.overview or build.goals or 'n/a'}",
        f"Pipeline: {' → '.join(s.name for s in stages) or 'none'}",
        f"Workflows: {', '.join(f'{w.code} {w.name}'.strip() for w in workflows) or 'none'}",
        f"Integrations: {build.integrations or 'none'}",
    ]
    if (build.memory_summary or '').strip():
        parts.append(f"Latest known state: {build.memory_summary}")
    return "\n".join(parts)[:6000]


_PROGRESS_DELTA_SCHEMA = _obj({
    "summary": _str(),            # updated running build-state summary
    "progress": _arr(_str()),     # status / what's done, reported this meeting
    "scopeChanges": _arr(_obj({   # new or changed requirements vs the current build
        "title": _str(),
        "description": _str(),
        "impact": _str(),
        "requester": _str(),      # e.g. "Client", a person, or ""
    })),
    "newQuestions": _arr(_obj({
        "category": _enum(
            "OVERVIEW", "STAGE", "TRANSITION", "LEAD_SOURCE", "CALENDAR",
            "INTEGRATION", "WORKFLOW", "CUSTOM_FIELD", "TAG", "GENERAL",
        ),
        "question": _str(),
        "rationale": _str(),
        "severity": _enum("high", "medium", "low"),
    })),
})


def extract_progress_delta(build, note_text: str) -> dict:
    """Read a follow-up/progress meeting note AGAINST the current build and return
    the delta: progress reported, scope changes (→ change requests), new questions
    (→ gaps), and an updated running summary. Does NOT rewrite the blueprint."""
    state = _build_state_summary(build)
    prompt = (
        "You are a senior Go High Level (GHL) solutions architect at Calari Solutions reviewing notes "
        "from a FOLLOW-UP / progress meeting on an in-flight build. Compare the new notes to the CURRENT "
        "build state and extract ONLY the delta:\n"
        "- progress: concrete status updates (what's done / in progress / blocked).\n"
        "- scopeChanges: NEW or CHANGED requirements vs the current build — each a specific change with "
        "its impact and who requested it (use 'Client' if the client asked). Do NOT list unchanged scope.\n"
        "- newQuestions: open items the meeting raised that must be answered before delivery.\n"
        "- summary: an updated, concise running summary of the build's CURRENT state incorporating this "
        "meeting (this becomes the build's living memory).\n\n"
        f"CURRENT BUILD STATE:\n{state}\n\n"
        f"NEW MEETING NOTES:\n{note_text[:MAX_TEXT_CHARS]}\n\n"
        "Return JSON matching the schema. Be specific and concise."
    )
    raw = _chat(
        [{"role": "user", "content": prompt}],
        response_format={"type": "json_schema", "json_schema": {"name": "progress_delta", "strict": True, "schema": _PROGRESS_DELTA_SCHEMA}},
    )
    return json.loads(raw) if raw else {}


# ─── Handover render (blueprint → client handover markdown) ───────────────────
_WORKFLOW_CATEGORY_LABELS = {
    "ACTIVE_CONVERSION": "Active conversion (A)",
    "INTAKE_ROUTING": "Intake & routing (IN)",
    "RECORD_KEEPING": "Record-keeping (REC)",
    "APPOINTMENT_LIFECYCLE": "Appointment lifecycle (E, K)",
    "POST_VISIT": "Post-visit & retention (G)",
    "INTERNAL_UTILITY": "Internal & utility (H, X, Y, Z)",
    "OTHER": "Other",
}


def render_handover_markdown(build) -> str:
    """Render a build's vision blueprint as the client-facing handover document.

    The handover stops being hand-written: it is a view of the captured blueprint.
    """
    stages = list(build.stages.all())
    sources = list(build.contact_sources.all())
    calendars = list(build.calendars.all())
    integrations = list(build.external_integrations.all())
    transitions = list(build.transitions.all())
    workflows = list(build.workflows.all())
    fields = list(build.custom_fields.all())
    tags = list(build.tags.all())
    checklist = list(build.pre_launch_items.all())
    out: list[str] = []

    def line(s: str = ""):
        out.append(s)

    line(f"# {build.title} — System Operation & Handover")
    line(f"\n*Client: {build.client.name if build.client_id else '—'}*")
    if build.one_line_summary:
        line(f"\n> {build.one_line_summary}")

    line("\n## 1. The big idea\n")
    line(build.overview or build.goals or "_Not captured yet._")

    if sources:
        line("\n## 2. Lead sources\n")
        line("| Source | How it enters | Fires | Tags | Workflow | Entry stage |")
        line("|---|---|---|---|---|---|")
        for s in sources:
            entry = s.entry_stage.name if s.entry_stage_id else ""
            line(f"| {s.label} | {s.entry_mechanism} | {s.fires} | {s.tags_applied} | {s.handling_workflow} | {entry} |")

    if stages:
        line("\n## 3. The pipeline\n")
        line("| # | Stage | What it means | How a lead gets here | Auto/Manual |")
        line("|---|---|---|---|---|")
        for st in stages:
            mode = "Auto" if st.is_automatic else "Manual"
            line(f"| {st.order} | {st.name} | {st.description} | {st.entry_condition} | {mode} |")

    if transitions:
        line("\n## 4. Stage movement\n")
        line("| Transition | Trigger | Auto/Manual |")
        line("|---|---|---|")
        for t in transitions:
            frm = (t.from_stage.name if t.from_stage_id else None) or t.from_label or "—"
            to = (t.to_stage.name if t.to_stage_id else None) or t.to_label or "—"
            mode = "Auto" if t.is_automatic else "Manual"
            line(f"| {frm} → {to} | {t.trigger} | {mode} |")

    if calendars:
        line("\n## 5. Calendars — the conversion points\n")
        line("| Calendar | Type | Books | Assigned to | Books into | On booking |")
        line("|---|---|---|---|---|---|")
        for c in calendars:
            into = c.books_into_stage.name if c.books_into_stage_id else ""
            line(f"| {c.name} | {c.get_type_display()} | {c.purpose} | {c.assigned_to} | {into} | {c.on_booking} |")

    if integrations:
        line("\n## 6. Integrations & data flows\n")
        line("| System | Direction | Mechanism | Data | Cadence | Purpose |")
        line("|---|---|---|---|---|---|")
        for ig in integrations:
            line(f"| {ig.name} | {ig.get_direction_display()} | {ig.get_mechanism_display()} | {ig.data_objects} | {ig.trigger_cadence} | {ig.purpose} |")

    if workflows:
        line("\n## 7. Every workflow, grouped by function\n")
        by_cat: dict[str, list] = {}
        for w in workflows:
            by_cat.setdefault(w.category, []).append(w)
        for cat, group in by_cat.items():
            line(f"\n### {_WORKFLOW_CATEGORY_LABELS.get(cat, cat)}\n")
            line("| Workflow | Trigger | What it does |")
            line("|---|---|---|")
            for w in group:
                name = f"{w.code} — {w.name}".strip(" —")
                line(f"| {name} | {w.trigger} | {w.what_it_does} |")

    if fields or tags:
        line("\n## 8. Custom fields, values & tags\n")
        for kind, heading in (("FIELD", "Custom fields"), ("VALUE", "Custom values")):
            group = [f for f in fields if f.kind == kind]
            if group:
                line(f"\n**{heading}:** " + ", ".join(
                    f"`{f.key}`" + ("" if f.populated else " _(needs value)_") for f in group
                ))
        if tags:
            line("\n**Tag glossary:** " + ", ".join(f"`{t.tag}`" + (f" ({t.meaning})" if t.meaning else "") for t in tags))

    if build.maintenance_notes:
        line("\n## 9. Maintenance notes\n")
        line(build.maintenance_notes)

    if checklist:
        line("\n## 10. Pre-launch checklist\n")
        for item in checklist:
            box = "[x]" if item.done else "[ ]"
            opt = " _(optional)_" if item.optional else ""
            line(f"- {box} {item.description}{opt}")

    return "\n".join(out) + "\n"


# ─── Document text extraction ─────────────────────────────────────────────────
def _extension(filename: str) -> str:
    i = filename.rfind(".")
    return filename[i:].lower() if i != -1 else ""


def _normalize(text: str) -> str:
    text = text.replace("\x00", "").replace("\r\n", "\n")
    while "\n\n\n\n" in text:
        text = text.replace("\n\n\n\n", "\n\n\n")
    return text.strip()


def is_ai_readable(filename: str, content_type: str = "") -> bool:
    ext = _extension(filename)
    return (
        ext in AI_READABLE_EXTENSIONS
        or content_type == "application/pdf"
        or content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        or content_type.startswith("text/")
    )


def extract_text(file_bytes: bytes, filename: str, content_type: str = "") -> str:
    ext = _extension(filename)
    if content_type.startswith("text/") or ext in (".txt", ".csv", ".md", ".rtf"):
        return _normalize(file_bytes.decode("utf-8", errors="ignore"))[:MAX_TEXT_CHARS]
    if content_type == "application/pdf" or ext == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(file_bytes))
        text = "\n".join((page.extract_text() or "") for page in reader.pages)
        return _normalize(text)[:MAX_TEXT_CHARS]
    if ext == ".docx" or content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        import docx

        document = docx.Document(io.BytesIO(file_bytes))
        text = "\n".join(p.text for p in document.paragraphs)
        return _normalize(text)[:MAX_TEXT_CHARS]
    return ""


# ─── S3 presigned uploads ─────────────────────────────────────────────────────
def _s3_client():
    import boto3

    kwargs = {
        "region_name": settings.AWS_S3_REGION_NAME,
        "aws_access_key_id": settings.AWS_ACCESS_KEY_ID,
        "aws_secret_access_key": settings.AWS_SECRET_ACCESS_KEY,
        # Honor the same TLS-verify setting django-storages uses, so presigned
        # uploads behave consistently with FileField saves.
        "verify": settings.AWS_S3_VERIFY,
    }
    if settings.AWS_S3_ENDPOINT_URL:
        kwargs["endpoint_url"] = settings.AWS_S3_ENDPOINT_URL
    return boto3.client("s3", **kwargs)


def public_url(key: str) -> str:
    bucket = settings.AWS_STORAGE_BUCKET_NAME
    if settings.AWS_S3_ENDPOINT_URL:
        return f"{settings.AWS_S3_ENDPOINT_URL}/{bucket}/{key}"
    return f"https://{bucket}.s3.{settings.AWS_S3_REGION_NAME}.amazonaws.com/{key}"


def presign_upload(filename: str, content_type: str) -> dict:
    bucket = settings.AWS_STORAGE_BUCKET_NAME
    if not bucket:
        raise RuntimeError("S3_BUCKET_NAME is not configured")
    ext = _extension(filename)
    key = f"uploads/{secrets.token_urlsafe(16)}{ext}"
    url = _s3_client().generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key, "ContentType": content_type},
        ExpiresIn=300,
    )
    return {"upload_url": url, "public_url": public_url(key), "key": key}


def delete_object(key: str) -> None:
    _s3_client().delete_object(Bucket=settings.AWS_STORAGE_BUCKET_NAME, Key=key)
