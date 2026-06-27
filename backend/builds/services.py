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
import re
import secrets
import time

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
_AI_MAX_RETRIES = int(os.getenv("AI_MAX_RETRIES", "4"))  # SDK retries on 429/5xx (rate-limit resilience)


def _openai_client():
    from openai import OpenAI

    key = get_active_provider_key("OPENAI")
    if not key:
        raise RuntimeError("OpenAI API key is not configured")
    return OpenAI(api_key=key, max_retries=_AI_MAX_RETRIES)


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


def _multi_pass_enabled() -> bool:
    """Architect→critic→revise pass on the blueprint. Off by default (it doubles the
    blueprint call); enable in Settings → AI Keys or via AI_MULTIPASS."""
    cfg = _ai_config()
    if cfg is not None:
        return bool(cfg.multi_pass)
    return os.getenv("AI_MULTIPASS", "False").lower() in ("1", "true", "yes")


def _openai_complete(model, messages, response_format, max_tokens):
    """Returns (content, usage_dict)."""
    client = _openai_client()
    kwargs = {"messages": messages}
    if response_format is not None:
        kwargs["response_format"] = response_format
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    completion = client.chat.completions.create(model=model, **kwargs)
    usage = getattr(completion, "usage", None)
    u = {
        "prompt": getattr(usage, "prompt_tokens", None),
        "completion": getattr(usage, "completion_tokens", None),
        "total": getattr(usage, "total_tokens", None),
    } if usage is not None else {}
    return completion.choices[0].message.content, u


def _anthropic_complete(model, messages, response_format, max_tokens):
    """Claude path. Structured output (OpenAI-style json_schema) is achieved via a
    forced tool call: the schema becomes the tool's input_schema and we return the
    tool input as a JSON string so callers' json.loads(...) works unchanged.
    Returns (content, usage_dict)."""
    import anthropic

    key = get_active_provider_key("ANTHROPIC")
    if not key:
        raise RuntimeError("Anthropic API key is not configured")
    client = anthropic.Anthropic(api_key=key, max_retries=_AI_MAX_RETRIES)

    # Anthropic separates the system prompt from the message list. Send it as blocks
    # and cache the first one (our big static expert prompt) so repeat calls reuse it
    # — large cost + latency win at volume (OpenAI caches such prefixes automatically).
    system_texts = [m["content"] for m in messages if m.get("role") == "system" and m.get("content")]
    conv = [{"role": m["role"], "content": m["content"]} for m in messages if m.get("role") in ("user", "assistant")]
    if not conv:
        conv = [{"role": "user", "content": ""}]
    kwargs = {"model": model, "max_tokens": max_tokens or 16000, "messages": conv}
    if system_texts:
        blocks = [{"type": "text", "text": t} for t in system_texts]
        blocks[0]["cache_control"] = {"type": "ephemeral"}
        kwargs["system"] = blocks

    def _usage(msg):
        u = getattr(msg, "usage", None)
        if u is None:
            return {}
        inp, out = getattr(u, "input_tokens", None), getattr(u, "output_tokens", None)
        return {"prompt": inp, "completion": out,
                "total": (inp + out) if inp is not None and out is not None else None}

    if response_format and response_format.get("type") == "json_schema":
        js = response_format["json_schema"]
        name = js.get("name", "result")
        kwargs["tools"] = [{"name": name, "description": "Return the structured result.", "input_schema": js["schema"]}]
        kwargs["tool_choice"] = {"type": "tool", "name": name}
        msg = client.messages.create(**kwargs)
        for block in msg.content:
            if getattr(block, "type", None) == "tool_use":
                return json.dumps(block.input), _usage(msg)
        return None, _usage(msg)
    msg = client.messages.create(**kwargs)
    return "".join(getattr(b, "text", "") for b in msg.content if getattr(b, "type", None) == "text"), _usage(msg)


def _record_ai_log(op, provider, model, usage, latency_ms, ok, error=""):
    """Persist one AI-call telemetry row. Never let logging break the call."""
    try:
        from .models import AiGenerationLog
        AiGenerationLog.objects.create(
            op=(op or "chat")[:32], provider=(provider or "")[:16], model=(model or "")[:64],
            prompt_tokens=usage.get("prompt"), completion_tokens=usage.get("completion"),
            total_tokens=usage.get("total"), latency_ms=latency_ms, ok=ok, error=(error or "")[:1000],
        )
    except Exception:  # noqa: BLE001
        pass


def _chat(messages, *, model: str | None = None, response_format=None, max_tokens=None, op: str = "chat") -> str:
    """One completion call routed to the active provider (OpenAI or Anthropic), with a
    graceful fallback (retry on the known-good OpenAI model) and per-call telemetry."""
    provider = _active_provider()
    target = model or _model()

    def _call(prov: str, m: str):
        if prov == "ANTHROPIC":
            return _anthropic_complete(m, messages, response_format, max_tokens)
        return _openai_complete(m, messages, response_format, max_tokens)

    t0 = time.monotonic()
    try:
        content, usage = _call(provider, target)
        _record_ai_log(op, provider, target, usage, int((time.monotonic() - t0) * 1000), True)
        return content
    except Exception as exc:  # noqa: BLE001 — APIError/missing key/model-not-found/etc.
        fb = _fallback_model()
        if provider == "OPENAI" and target == fb:
            _record_ai_log(op, provider, target, {}, int((time.monotonic() - t0) * 1000), False, str(exc))
            raise
        t1 = time.monotonic()
        try:
            content, usage = _call("OPENAI", fb)
            _record_ai_log(op, "OPENAI", fb, usage, int((time.monotonic() - t1) * 1000), True,
                           f"fallback from {provider}/{target}: {exc}")
            return content
        except Exception as exc2:  # noqa: BLE001
            _record_ai_log(op, "OPENAI", fb, {}, int((time.monotonic() - t1) * 1000), False, str(exc2))
            raise


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
    "CALARI STANDARD BUILD PATTERNS — these recur across our portfolio (dental, med-spa, "
    "recruitment, home services, auto, events). Include the ones that fit, even when the notes "
    "don't name them, marked inferred=true with a confidence level, and emit them through the "
    "existing schema (workflows / preLaunchItems / tasks / gaps / externalIntegrations):\n"
    "- Speed-to-lead: an auto-reply (email + SMS) within ~5 minutes of a form fill, plus an "
    "internal alert to the ASSIGNED owner (not all users) with the contact's name/phone and a "
    "follow-up task.\n"
    "- Nurture: separate sequences for unqualified (warm-up) vs qualified (push-to-book) leads; "
    "multi-touch SMS+email cadence; suppress/exit the moment they book.\n"
    "- Appointment lifecycle: booking confirmation, reminders (commonly 24h + 1–2h before), "
    "no-show recovery (graduated; only mark Lost after a rebooking window), and a reschedule flow "
    "that CLEARS stale reminders and re-queues new ones.\n"
    "- Post-visit: review request + referral ask after completion.\n"
    "- Lead-source routing & tagging for clean attribution; a lead-value step that reads a "
    "budget/qualification field and sets the opportunity value.\n"
    "- Internal ops: booking alerts to the assigned rep and a daily digest of upcoming "
    "appointments where useful.\n"
    "- External app sync (often BIDIRECTIONAL GHL<->client app): appointments, estimates/quotes, "
    "invoices, and pipeline-stage status — capture under externalIntegrations.\n"
    "- Reporting pipelines: a data source -> Google Sheet -> reporting tool (scorecards/dashboards) "
    "on a daily sync — capture as an OUTBOUND externalIntegration and note the sync cadence/latency.\n"
    "- Embedded AI qualification: an AI step that validates eligibility (e.g., location/state) and "
    "routes or auto-disqualifies — capture as a workflow and flag what it decides.\n"
    "- Hygiene an expert always sets: sticky/dedup contacts, two-way calendar sync, and correct "
    "email sender identity (assigned-user From-name + signature, never a blank merge tag).\n\n"
    "A2P / SMS COMPLIANCE — MANDATORY whenever ANY workflow sends SMS (it is a required "
    "pre-launch workstream, not a nicety, and is the most common thing that blocks go-live). When "
    "the build sends SMS, ALWAYS include:\n"
    "- preLaunchItems for: a compliant Privacy Policy + Terms of Service; an SMS consent flow "
    "(unchecked opt-in checkbox, optional phone field, 'consent not required to purchase', message "
    "types, 'message & data rates may apply', STOP/HELP instructions, and the mandatory "
    "'no mobile information will be shared with third parties for marketing' clause); and Twilio "
    "brand + campaign registration under the Customer Care / transactional use case with sample "
    "messages.\n"
    "- tasks to build the consent flow and submit the brand + campaign registration.\n"
    "- an externalIntegration for the Twilio messaging service (mechanism API/NATIVE) connected to GHL.\n"
    "- gaps for the unknowns that cause rejections: legal business name/DBA, the public opt-in form "
    "URL, the campaign use case, and which sending numbers to link. RAISE these known failure modes "
    "as gaps/notes: opt-in error 30896 (reviewers can't verify opt-in — promotional content on the "
    "main site conflicts with a transactional Customer-Care campaign, often forcing a dedicated "
    "standalone compliance website); TOLL-FREE numbers will NOT connect to GHL (use a LOCAL number); "
    "and a previously approved brand may need deletion/reset before a clean resubmission.\n\n"
    "Meeting notes may include a kickoff plus later updates. Treat the earliest notes as the baseline "
    "intent and later notes as refinements that supersede earlier details only when they clearly "
    "conflict. Preserve unchanged context. Return only data matching the schema."
)


KNOWLEDGE_MAX_CHARS = 8000
_REF_PER_DOC_CHARS = 2500
_REF_SAME_CLIENT = 3   # how many same-client docs to include
_REF_OTHER = 2         # how many general/other-client docs to include
# Common words that carry no signal for matching a build to a reference doc.
_REF_STOPWORDS = frozenset((
    "the and for with that this from your you our are has have was were will "
    "build builds client clients lead leads contact contacts workflow workflows "
    "ghl gohighlevel system update completed pending into when then they them"
).split())


def _ref_tokenize(text: str) -> set[str]:
    """Lowercase word set used for lightweight relevance scoring (>2 chars, no stopwords)."""
    return {t for t in re.findall(r"[a-z0-9]+", (text or "").lower())
            if len(t) > 2 and t not in _REF_STOPWORDS}


def relevance_score(doc_text: str, query_tokens: set[str]) -> int:
    """Number of distinct query tokens that appear in the doc — a cheap, dependency-free
    proxy for 'how relevant is this past build to the one being generated'. Pure function
    so it can be unit-tested without a database."""
    if not query_tokens:
        return 0
    return len(query_tokens & _ref_tokenize(doc_text))


_REF_CANDIDATE_LIMIT = 25  # cap docs pulled into memory regardless of library size


def _candidate_docs(build, query_text: str):
    """Bounded candidate set for reference selection — SCALES by ranking + LIMITing at
    the DB (Postgres full-text search; no extension needed) instead of loading the whole
    library into memory. Always includes recent same-client docs (so client context is
    never missed), then the most lexically-relevant general docs. Falls back to most-recent
    if FTS is unavailable or matches nothing. Final fine-ranking happens in Python on this
    bounded set."""
    from .models import BuildKnowledge

    base = BuildKnowledge.objects.filter(use_for_ai=True)
    out: dict = {}
    if getattr(build, "client_id", None):
        for d in base.filter(client_id=build.client_id).order_by("-created_at")[:_REF_CANDIDATE_LIMIT]:
            out[d.id] = d

    general = None
    if query_text.strip():
        try:
            from django.contrib.postgres.search import SearchVector, SearchQuery, SearchRank
            vector = (
                SearchVector("title", weight="A")
                + SearchVector("summary", weight="B")
                + SearchVector("raw_text", weight="D")
            )
            query = SearchQuery(query_text, search_type="websearch")
            general = list(
                base.annotate(rank=SearchRank(vector, query)).filter(rank__gt=0)
                .order_by("-rank")[:_REF_CANDIDATE_LIMIT]
            )
        except Exception:  # noqa: BLE001 — FTS unavailable/misconfig → recency fallback
            general = None
    if not general:
        general = list(base.order_by("-created_at")[:_REF_CANDIDATE_LIMIT])

    for d in general:
        out.setdefault(d.id, d)
    return list(out.values())


# ─── Semantic vector retrieval (optional second DB: pgvector) ─────────────────
EMBED_MODEL = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small")
EMBED_DIM = 1536


def _vectors_enabled() -> bool:
    return getattr(settings, "VECTOR_DB_ALIAS", "vectors") in settings.DATABASES


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed text via OpenAI (embeddings are OpenAI regardless of the chat provider)."""
    client = _openai_client()
    t0 = time.monotonic()
    resp = client.embeddings.create(model=EMBED_MODEL, input=texts)
    usage = getattr(resp, "usage", None)
    _record_ai_log(
        "embed", "OPENAI", EMBED_MODEL,
        {"prompt": getattr(usage, "prompt_tokens", None), "total": getattr(usage, "total_tokens", None)},
        int((time.monotonic() - t0) * 1000), True,
    )
    return [d.embedding for d in resp.data]


def _chunk_text(text: str, size: int = 1500, overlap: int = 150, max_chunks: int = 50) -> list[str]:
    text = (text or "").strip()
    if not text:
        return []
    chunks, i = [], 0
    step = max(size - overlap, 1)
    while i < len(text) and len(chunks) < max_chunks:
        chunks.append(text[i:i + size])
        i += step
    return chunks


def index_knowledge(knowledge) -> int:
    """(Re)build the vector chunks for one BuildKnowledge doc in the vectors DB.
    No-op when the vector DB isn't configured."""
    if not _vectors_enabled():
        return 0
    from vectorstore.models import BuildKnowledgeChunk

    BuildKnowledgeChunk.objects.filter(knowledge_id=knowledge.id).delete()
    if not knowledge.use_for_ai:
        return 0
    text = "\n\n".join(filter(None, [knowledge.summary, knowledge.raw_text]))
    chunks = _chunk_text(text)
    if not chunks:
        return 0
    vectors = embed_texts(chunks)
    BuildKnowledgeChunk.objects.bulk_create([
        BuildKnowledgeChunk(
            knowledge_id=knowledge.id, client_id=knowledge.client_id, title=knowledge.title,
            chunk_index=i, content=c, embedding=v, use_for_ai=True,
        )
        for i, (c, v) in enumerate(zip(chunks, vectors))
    ])
    return len(chunks)


def delete_knowledge_chunks(knowledge_id) -> int:
    if not _vectors_enabled():
        return 0
    from vectorstore.models import BuildKnowledgeChunk
    deleted, _ = BuildKnowledgeChunk.objects.filter(knowledge_id=knowledge_id).delete()
    return deleted


def _semantic_context(build, query_text: str):
    """Top relevant chunks by cosine similarity from the pgvector store, preferring
    same-client docs. Returns None (→ caller falls back to FTS) if unavailable."""
    if not _vectors_enabled() or not query_text.strip():
        return None
    try:
        from vectorstore.models import BuildKnowledgeChunk
        from pgvector.django import CosineDistance

        qv = embed_texts([query_text])[0]
        base = BuildKnowledgeChunk.objects.filter(use_for_ai=True).annotate(
            dist=CosineDistance("embedding", qv))
        rows, seen = [], set()
        if getattr(build, "client_id", None):
            for r in base.filter(client_id=build.client_id).order_by("dist")[:4]:
                rows.append(r); seen.add(r.id)
        for r in base.order_by("dist")[:8]:
            if r.id not in seen:
                rows.append(r); seen.add(r.id)
        if not rows:
            return None
        parts, budget = [], KNOWLEDGE_MAX_CHARS
        for r in rows:
            block = f"### {r.title}\n{r.content.strip()[:_REF_PER_DOC_CHARS]}"
            if parts and budget - len(block) < 0:
                break
            parts.append(block)
            budget -= len(block)
        return ("\n\n".join(parts)[:KNOWLEDGE_MAX_CHARS]) or None
    except Exception:  # noqa: BLE001 — any failure → FTS fallback
        logger.exception("semantic retrieval failed; falling back to full-text search")
        return None


def build_reference_context(build) -> str:
    """Gather excerpts from the Build Library (use_for_ai docs) as reference material so
    generation learns from how Calari actually builds. Prefers same-client docs, then
    general ones; within each group the most RELEVANT docs (by overlap with this build's
    title/goals/integrations) come first, so the library can grow without burying the
    references that actually match the build being generated. Capped in count and size."""
    query_text = " ".join(filter(None, (
        getattr(build, "title", ""), getattr(build, "goals", ""), getattr(build, "integrations", ""),
    )))

    # Semantic first (pgvector second DB) when configured; FTS keyword path otherwise.
    semantic = _semantic_context(build, query_text)
    if semantic:
        return semantic

    query_tokens = _ref_tokenize(query_text)
    docs = _candidate_docs(build, query_text)  # bounded + DB-ranked; never loads the whole library

    def ranked(group):
        # Highest relevance first; sorted() is stable so ties keep the queryset's
        # default ordering (most recent first).
        return sorted(group, key=lambda d: relevance_score(
            f"{d.title} {d.summary} {d.raw_text}", query_tokens), reverse=True)

    same = ranked([d for d in docs if build.client_id and d.client_id == build.client_id])[:_REF_SAME_CLIENT]
    same_ids = {d.id for d in same}
    other = ranked([d for d in docs if d.id not in same_ids])[:_REF_OTHER]

    parts, budget = [], KNOWLEDGE_MAX_CHARS
    for d in same + other:
        excerpt = (d.summary or d.raw_text or "").strip()[:_REF_PER_DOC_CHARS]
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
        op="blueprint",
    )
    if not raw:
        raise RuntimeError("AI returned no content")
    draft = json.loads(raw)
    if _multi_pass_enabled():
        draft = _critique_and_revise(draft, notes_text, reference_text)
    return draft


def _critique_and_revise(draft: dict, notes_text: str, reference_text: str = "") -> dict:
    """Architect→critic→revise: a second pass that reviews the draft against the notes
    and our standard patterns and returns an IMPROVED blueprint (same schema). Falls
    back to the original draft on any error so it can never make things worse."""
    try:
        messages = [
            {"role": "system", "content": _BLUEPRINT_SYSTEM_PROMPT},
            {"role": "system", "content": (
                "You are now the REVIEWER. You are given a DRAFT blueprint another architect produced from "
                "the same notes. Critique it for completeness and consistency, then return an IMPROVED "
                "blueprint in the same schema: fill missing workflows / pre-launch & A2P-SMS compliance "
                "items, fix broken stage references and half-drawn contact journeys, and tighten naming "
                "to our conventions. Keep everything correct from the draft — only add or fix, never drop "
                "good content."
            )},
        ]
        if reference_text.strip():
            messages.append({"role": "system", "content": "REFERENCE:\n" + reference_text[:KNOWLEDGE_MAX_CHARS]})
        messages.append({"role": "user", "content": (
            f"Client meeting notes:\n\n{notes_text[:MAX_TEXT_CHARS]}\n\n"
            f"DRAFT blueprint to improve (same schema):\n{json.dumps(draft)[:60000]}"
        )})
        raw = _chat(
            messages, model=_blueprint_model(),
            response_format={"type": "json_schema",
                             "json_schema": {"name": "build_blueprint", "strict": True, "schema": _BLUEPRINT_SCHEMA}},
            op="blueprint_revise",
        )
        return json.loads(raw) if raw else draft
    except Exception:  # noqa: BLE001 — never let the critic pass break generation
        logger.exception("multi-pass revise failed; using original draft")
        return draft


# ─── Implementation build document (long-form, step-by-step for the builder) ───
# The blueprint (structured JSON) is the architecture; THIS turns it into the
# implementer-facing build document a team member follows directly in GHL —
# the 24-section format with every workflow expanded into builder-level steps.
_BUILD_DOCUMENT_SYSTEM_PROMPT = (
    "You are a senior GoHighLevel (GHL) CRM architect and marketing-automation strategist at "
    "Calari Solutions. Turn the build blueprint + meeting notes you are given into a COMPLETE, "
    "end-to-end IMPLEMENTATION BUILD DOCUMENT that a GHL implementer can follow directly inside "
    "the workflow builder — not a summary, and not generic CRM advice. Be specific, practical, and "
    "exhaustive; prefer completeness over brevity. Use the EXACT pipeline stage names, workflow "
    "names, field names, tag names, calendar names and dashboard metric names from the blueprint "
    "(invent missing ones in the same style and naming convention, and mark anything you assumed). "
    "Respect the system-of-record split stated in the notes: GHL owns sales & marketing (capture, "
    "pipeline, nurture, booking, follow-up, upsell, reporting, ad conversion tracking); any external "
    "tool named as the source of truth (e.g. an event/contract/PMS system) keeps contracts, "
    "logistics, staffing and core financials — bridge milestones back into GHL via forms/webhooks "
    "keyed on a unique identifier (usually phone).\n\n"
    "Output GitHub-flavored Markdown with these numbered sections, in order:\n"
    "1. Business goals (include the target metric movement if stated)\n"
    "2. CRM architecture (each system and what it owns; the integration map)\n"
    "3. Pipeline stages (the ordered list)\n"
    "4. Detailed pipeline flow (the end-to-end journey)\n"
    "5. Contact fields & custom values needed\n6. Tags needed\n7. Lead sources\n"
    "8. Calendar setup\n9. Forms needed\n10. Automations/workflows needed (overview list)\n"
    "11. Trigger logic for each workflow\n12. If/then branches\n13. Entry & exit conditions\n"
    "14. Email/SMS sequence structure (per sequence: day/step, channel, purpose)\n"
    "15. Internal notifications\n16. External source-of-truth integration flow (forms/webhooks "
    "that report milestones back to GHL)\n17. Payment / payment-link flow\n18. Upsell flow\n"
    "19. Reporting dashboards (name each metric)\n20. Ad conversion tracking (which milestones fire "
    "which events)\n21. Testing checklist\n22. Launch checklist\n23. 2–3 week implementation "
    "timeline (Week 1/2/3)\n24. Client assets/information needed before build\n\n"
    "THE AUTOMATION SECTION IS THE CORE — expand EVERY workflow in full implementation detail. For "
    "each workflow use this exact structure:\n"
    "  - Workflow name\n  - Purpose\n  - Trigger (exact GHL trigger + filters)\n  - Enrollment/"
    "stop & re-entry rules\n  - Step-by-step actions (numbered, in builder order: create/find "
    "contact, if/else conditions, send email/SMS with the template name, wait steps with exact "
    "durations, update opportunity stage, add/remove tags, assign user, internal notification, "
    "webhook/HTTP, fire ad event)\n  - Wait steps (exact durations)\n  - If/else branches (each "
    "condition and what happens)\n  - Pipeline movement (from-stage → to-stage)\n  - Tags "
    "added/removed\n  - Notifications sent (to whom, channel, content)\n  - Stop conditions\n"
    "  - Success metric\n\n"
    "For EACH pipeline stage, also document: stage name; what qualifies a lead to ENTER; what "
    "automation happens IN the stage; what MOVES the lead to the next stage; what can go wrong; how "
    "to REPORT on the stage.\n\n"
    "Always include the standard Calari deliverables an expert ships even if unstated (speed-to-lead "
    "auto-reply within ~5 min + internal alert to the ASSIGNED rep + task; unqualified vs qualified "
    "nurtures that suppress on booking; appointment confirmation + reminders 24h/2h + no-show "
    "recovery + reschedule flow that clears stale reminders; post-visit/post-consult review & "
    "referral; pipeline-stage movers), and — whenever the build sends SMS — an A2P / SMS COMPLIANCE "
    "workstream (compliant Privacy Policy + Terms with the verbatim non-sharing clause; unchecked "
    "opt-in consent flow; Twilio brand + campaign under the Customer Care/transactional use case) "
    "with its real failure modes called out (opt-in error 30896 → standalone compliance website "
    "possibly needing a brand reset; toll-free numbers will NOT connect to GHL — use a local "
    "number). Put compliance and any unknowns into the testing/launch checklists and the "
    "client-assets section. Base everything on the blueprint and notes provided; do not contradict "
    "them. Return ONLY the Markdown build document."
)


def _full_build_context(build) -> str:
    """A complete text dump of the captured blueprint for the document generator — richer
    than _build_state_summary (which is for deltas). Mirrors the handover anatomy."""
    sources = list(build.contact_sources.all())
    cals = list(build.calendars.all())
    integ = list(build.external_integrations.all())
    trans = list(build.transitions.all())
    wfs = list(build.workflows.all())
    fields = list(build.custom_fields.all())
    tags = list(build.tags.all())
    checklist = list(build.pre_launch_items.all())
    tasks = list(build.tasks.all())
    gaps = list(build.gaps.all())
    p = [
        f"CLIENT: {build.client.name if build.client_id else 'n/a'}",
        f"TITLE: {build.title}",
        f"ONE-LINE: {build.one_line_summary or 'n/a'}",
        f"OVERVIEW: {build.overview or build.goals or 'n/a'}",
        f"GOALS: {build.goals or 'n/a'}",
        f"INTEGRATIONS: {build.integrations or 'none'}",
    ]
    if (build.maintenance_notes or "").strip():
        p.append(f"MAINTENANCE: {build.maintenance_notes}")
    stages = list(build.stages.all())
    if stages:
        p.append("PIPELINE STAGES:")
        for st in stages:
            mode = "auto" if st.is_automatic else "manual"
            p.append(f"  {st.order}. {st.name} [{mode}] — {st.description} | enter: {st.entry_condition}")
    if trans:
        p.append("STAGE TRANSITIONS:")
        for t in trans:
            frm = (t.from_stage.name if t.from_stage_id else None) or t.from_label or "—"
            to = (t.to_stage.name if t.to_stage_id else None) or t.to_label or "—"
            p.append(f"  {frm} → {to} | trigger: {t.trigger} | {'auto' if t.is_automatic else 'manual'}")
    if sources:
        p.append("LEAD SOURCES:")
        for so in sources:
            entry = so.entry_stage.name if so.entry_stage_id else ""
            p.append(f"  {so.label}: enters via {so.entry_mechanism}; fires {so.fires}; "
                     f"tags {so.tags_applied}; workflow {so.handling_workflow}; → {entry}")
    if cals:
        p.append("CALENDARS:")
        for c in cals:
            into = c.books_into_stage.name if c.books_into_stage_id else ""
            p.append(f"  {c.name} ({c.get_type_display()}): {c.purpose}; assigned {c.assigned_to}; "
                     f"→ {into}; on booking: {c.on_booking}; reminders: {c.reminders}")
    if integ:
        p.append("EXTERNAL INTEGRATIONS:")
        for ig in integ:
            p.append(f"  {ig.name} [{ig.get_direction_display()}/{ig.get_mechanism_display()}]: "
                     f"{ig.data_objects}; {ig.trigger_cadence}; {ig.purpose}")
    if wfs:
        p.append("WORKFLOWS:")
        for w in wfs:
            name = f"{w.code} {w.name}".strip()
            p.append(f"  {name} [{w.category}]: trigger {w.trigger} — {w.what_it_does}")
    if fields:
        p.append("CUSTOM FIELDS/VALUES: " + ", ".join(
            f"{f.key}({f.kind}{'' if f.populated else ',NEEDS VALUE'})" for f in fields))
    if tags:
        p.append("TAGS: " + ", ".join(f"{t.tag} ({t.meaning})" if t.meaning else t.tag for t in tags))
    if tasks:
        p.append("TASKS: " + "; ".join(f"{t.title} [{t.type}]" for t in tasks))
    if checklist:
        p.append("PRE-LAUNCH: " + "; ".join(
            i.description + (" (optional)" if i.optional else "") for i in checklist))
    if gaps:
        p.append("OPEN GAPS: " + "; ".join(f"[{g.severity}] {g.question}" for g in gaps))
    return "\n".join(p)


def generate_build_document(build, notes_text: str = "", reference_text: str = "") -> str:
    """Generate the long-form, step-by-step GHL implementation build document for a build.

    Pulls the captured blueprint, the original meeting notes, and Build-Library reference
    context (the learning loop), then asks the smartest model for the full 24-section build
    doc with every workflow expanded into builder-level steps. Returns Markdown.
    """
    if not notes_text:
        notes_text = "\n\n".join(
            build.meeting_notes.order_by("created_at").values_list("raw_text", flat=True)
        )
    if not reference_text:
        try:
            reference_text = build_reference_context(build)
        except Exception:  # noqa: BLE001 — reference is a bonus, never block generation
            reference_text = ""

    messages = [{"role": "system", "content": _BUILD_DOCUMENT_SYSTEM_PROMPT}]
    if reference_text.strip():
        messages.append({"role": "system", "content": (
            "REFERENCE — how Calari has built similar systems (Build Library). Match our naming, "
            "structure and conventions; adapt rather than copy client-specific details:\n\n"
            + reference_text[:KNOWLEDGE_MAX_CHARS]
        )})
    messages.append({"role": "user", "content": (
        "Produce the complete implementation build document.\n\n"
        f"BUILD BLUEPRINT (captured structure):\n{_full_build_context(build)}\n\n"
        f"ORIGINAL MEETING NOTES:\n{notes_text[:MAX_TEXT_CHARS]}"
    )})

    doc = (_chat(messages, model=_blueprint_model(), max_tokens=16000, op="build_document") or "").strip()
    if not doc:
        raise RuntimeError("AI returned no build-document content")
    return doc


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
        op="qa",
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
    sop = (_chat([{"role": "user", "content": prompt}], max_tokens=800, op="sop") or "").strip()
    if not sop:
        raise RuntimeError("AI returned no SOP content")
    return sop


def generate_change_request_steps(change_request) -> str:
    """Generate implementer-facing steps for a mid-build client update."""
    build = change_request.build
    stages = list(build.stages.all())
    workflows = list(build.workflows.all())
    fields = list(build.custom_fields.all())
    tags = list(build.tags.all())
    context = "\n".join([
        f"Build title: {build.title}",
        f"Build goals: {build.goals or 'not specified'}",
        f"Pipeline stages: {' → '.join(s.name for s in stages) or 'none'}",
        f"Workflows: {', '.join(f'{w.code} {w.name}'.strip() for w in workflows) or 'none'}",
        f"Custom fields/values: {', '.join(f.key for f in fields) or 'none'}",
        f"Tags: {', '.join(t.tag for t in tags) or 'none'}",
    ])
    prompt = (
        "You are a senior GoHighLevel implementation architect at Calari Solutions. "
        "A client added or changed scope midway through an active build. Convert this update into "
        "specific implementation steps a GHL builder can follow. Include affected workflows, fields, "
        "tags, pipeline movement, testing, and rollback/QA notes. If information is missing, list the "
        "exact blocker questions at the end.\n\n"
        f"CHANGE TITLE: {change_request.title}\n"
        f"DESCRIPTION: {change_request.description}\n"
        f"IMPACT: {change_request.impact or 'not specified'}\n\n"
        f"CURRENT BUILD CONTEXT:\n{context}\n\n"
        "Return only the implementation steps in numbered Markdown."
    )
    steps = (_chat([{"role": "user", "content": prompt}], max_tokens=1800, op="change_request_steps") or "").strip()
    if not steps:
        raise RuntimeError("AI returned no change-request implementation steps")
    return steps


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
        op="gap_suggest",
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
        op="progress_delta",
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
