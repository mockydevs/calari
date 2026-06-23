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
