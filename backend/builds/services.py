"""
Builds — non-CRUD service logic, ported from the Next.js lib/{ai,s3,document-text,
api-keys}.ts. Pure functions; views/tasks call into these.
"""
import base64
import hashlib
import io
import json
import os
import secrets

from django.conf import settings

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


def _model() -> str:
    return os.getenv("OPENAI_MODEL", "gpt-4o-mini")


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


_BLUEPRINT_SCHEMA = _obj({
    "overview": _str(),          # "The big idea" — the single-source-of-truth narrative
    "oneLineSummary": _str(),    # one-sentence summary for the team
    "goals": _str(),
    "integrations": _arr(_str()),
    "maintenanceNotes": _str(),  # services, env vars, cadence — empty if unknown
    "leadSources": _arr(_obj({
        "type": _enum("WEBSITE", "ADS", "MANUAL", "OTHER"),
        "label": _str(),
        "entryMechanism": _str(),     # how it enters: form trigger, webhook, cron sync…
        "fires": _str(),              # side effects: Meta CAPI, internal alerts, tasks…
        "tagsApplied": _str(),        # comma-separated tags applied on entry
        "handlingWorkflow": _str(),   # workflow code that handles it, e.g. "IN1"
        "entryStage": _str(),         # name of the pipeline stage it lands in
        "notes": _str(),
    })),
    "pipelineStages": _arr(_obj({
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
    "calendars": _arr(_obj({          # booking objects — the conversion point
        "name": _str(),
        "type": _enum("ROUND_ROBIN", "COLLECTIVE", "CLASS", "SERVICE", "PERSONAL", "OTHER"),
        "purpose": _str(),            # what it books: consult, in-person visit, demo…
        "assignedTo": _str(),         # team members / providers
        "booksIntoStage": _str(),     # name of the stage a booking lands in
        "onBooking": _str(),          # what fires on booking (workflow, tags, reminders)
        "reminders": _str(),          # reminder/confirmation cadence
        "notes": _str(),
    })),
    "integrations": _arr(_obj({       # external systems wired to GHL (any direction)
        "name": _str(),               # Patient Prism, Modento, QuickBooks, custom ERP…
        "direction": _enum("INBOUND", "OUTBOUND", "BIDIRECTIONAL"),
        "mechanism": _enum("API", "WEBHOOK", "NATIVE", "ZAPIER", "CRON", "OTHER"),
        "dataObjects": _str(),        # contacts, appointments, quotes, invoices, payments…
        "purpose": _str(),
        "triggerCadence": _str(),     # real-time, daily cron, on stage change…
        "notes": _str(),
    })),
    "workflows": _arr(_obj({
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
    "You are a senior solutions architect at Calari Solutions, an automation agency that builds "
    "client systems in Go High Level (GHL), Zapier, Patient Prism, and similar tools.\n\n"
    "Your job is to turn client meeting notes into a COMPLETE system blueprint — the same structure "
    "that appears in our end-of-build client handover. The blueprint must capture the client's vision "
    "precisely so the delivered build never strays from what they asked for. Extract:\n"
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
    "- integrations: every external system wired to GHL, in ANY direction. INBOUND tools feed contacts "
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


def generate_blueprint_draft(notes_text: str) -> dict:
    """Extract the full vision blueprint (handover anatomy) + gaps from meeting notes."""
    client = _openai_client()
    completion = client.chat.completions.create(
        model=_model(),
        messages=[
            {"role": "system", "content": _BLUEPRINT_SYSTEM_PROMPT},
            {"role": "user", "content": f"Client meeting notes:\n\n{notes_text[:MAX_TEXT_CHARS]}"},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "build_blueprint", "strict": True, "schema": _BLUEPRINT_SCHEMA},
        },
    )
    raw = completion.choices[0].message.content
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
    client = _openai_client()
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
    completion = client.chat.completions.create(
        model=_model(),
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_schema", "json_schema": {"name": "qa_report", "strict": True, "schema": _QA_SCHEMA}},
    )
    raw = completion.choices[0].message.content
    if not raw:
        raise RuntimeError("AI returned no QA content")
    return json.loads(raw)


def generate_task_sop(task) -> str:
    client = _openai_client()
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
    completion = client.chat.completions.create(
        model=_model(), messages=[{"role": "user", "content": prompt}], max_tokens=800,
    )
    sop = (completion.choices[0].message.content or "").strip()
    if not sop:
        raise RuntimeError("AI returned no SOP content")
    return sop


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
