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


def _derive_key(secret: str) -> bytes:
    return hashlib.scrypt(secret.encode(), salt=_SCRYPT_SALT, n=16384, r=8, p=1, dklen=32, maxmem=64 * 1024 * 1024)


def _encryption_secrets() -> list[str]:
    """Encryption secrets in precedence order. The first is used to ENCRYPT; all are
    tried (in order) to DECRYPT — so rotating API_KEY_ENCRYPTION_SECRET (or SECRET_KEY)
    doesn't orphan existing tokens. Set API_KEY_ENCRYPTION_SECRET_FALLBACKS (comma-
    separated) to the old secret(s) during a rotation, then run `reencrypt_secrets`."""
    out: list[str] = []
    for s in [
        os.getenv("API_KEY_ENCRYPTION_SECRET"),
        *os.getenv("API_KEY_ENCRYPTION_SECRET_FALLBACKS", "").split(","),
        settings.SECRET_KEY,  # always a fallback (legacy values encrypted with it)
    ]:
        s = (s or "").strip()
        if s and s not in out:
            out.append(s)
    if not out:
        raise RuntimeError("API_KEY_ENCRYPTION_SECRET or SECRET_KEY is required to store provider keys")
    return out


def _encryption_key() -> bytes:
    """The primary key used to encrypt new values."""
    return _derive_key(_encryption_secrets()[0])


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
    last_err: Exception | None = None
    for secret in _encryption_secrets():
        try:
            return AESGCM(_derive_key(secret)).decrypt(iv, ct + tag, None).decode()
        except Exception as e:  # noqa: BLE001 — try the next (rotation) key
            last_err = e
    raise ValueError(f"Could not decrypt stored secret with any configured key: {last_err}")


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


class AiSpendCapExceeded(RuntimeError):
    """Raised when today's AI token usage has hit the configured daily ceiling."""


def _daily_token_cap() -> int:
    """Daily output-token ceiling across all AI ops. 0/unset = unlimited."""
    try:
        return int(os.getenv("AI_DAILY_TOKEN_CAP", "0"))
    except ValueError:
        return 0


def _tokens_used_today() -> int:
    from datetime import date as _date
    from django.db.models import Sum
    from .models import AiGenerationLog
    start = _date.today()
    total = (AiGenerationLog.objects.filter(created_at__date=start)
             .aggregate(t=Sum("total_tokens")).get("t"))
    return int(total or 0)


def _chat(messages, *, model: str | None = None, response_format=None, max_tokens=None, op: str = "chat") -> str:
    """One completion call routed to the active provider (OpenAI or Anthropic), with a
    graceful fallback (retry on the known-good OpenAI model) and per-call telemetry.

    Enforces a daily token ceiling (AI_DAILY_TOKEN_CAP) as a cost-runaway backstop."""
    cap = _daily_token_cap()
    if cap and _tokens_used_today() >= cap:
        _record_ai_log(op, _active_provider(), model or "", {}, 0, False, "daily AI token cap reached")
        raise AiSpendCapExceeded(f"Daily AI token cap ({cap}) reached — try again tomorrow or raise the cap.")
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


# ─── Implementation build document (long-form, step-by-step for the builder) ───
# The blueprint (structured JSON) is the architecture; THIS turns it into the
# implementer-facing build document a team member follows directly in GHL —
# the 24-section format with every workflow expanded into builder-level steps.
_BUILD_DOCUMENT_SYSTEM_PROMPT = (
    "You are a senior GoHighLevel (GHL) CRM architect and marketing-automation strategist at "
    "Calari Solutions. Turn the captured build plan (a source-faithful tasklist of the client's "
    "requests, grouped by GHL area) + meeting notes you are given into a COMPLETE, "
    "end-to-end IMPLEMENTATION BUILD DOCUMENT that a GHL implementer can follow directly inside "
    "the workflow builder — not a summary, and not generic CRM advice. Be specific, practical, and "
    "exhaustive; prefer completeness over brevity. Derive the pipeline stages, workflows, fields, "
    "tags, calendars and dashboard metrics from the captured requests and notes "
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
    "client-assets section. Base everything on the captured requests and notes provided; do not "
    "contradict them. Return ONLY the Markdown build document."
)


_DOC_SECTION_LABELS = {
    "PIPELINE": "Pipeline", "AUTOMATIONS": "Automations", "CLIENT_UPDATES": "New features & updates",
    "LEAD_SOURCES": "Lead sources", "CALENDARS": "Calendars", "INTEGRATIONS": "Integrations",
    "FIELDS_TAGS": "Fields & tags", "FORMS_PAYMENTS": "Forms & payments",
    "REPORTING_LAUNCH": "Reporting & launch", "": "Other / uncategorized",
}


def _full_build_context(build) -> str:
    """A complete text dump of the captured build for the document generator: the build
    narrative + the source-faithful meeting tasklist grouped by GHL section + open change
    requests. Purely notes-driven — no rigid blueprint structure is assumed."""
    items = list(build.action_items.filter(superseded=False))
    tasks = list(build.tasks.all())
    changes = [c for c in build.change_requests.all()
               if c.status not in ("IMPLEMENTED", "REJECTED", "DEFERRED")]
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
    if (build.memory_summary or "").strip():
        p.append(f"CURRENT BUILD STATE: {build.memory_summary}")

    p.append("\nCAPTURED REQUESTS (verbatim from the meeting notes, grouped by GHL area):")
    by_section = {}
    for it in items:
        by_section.setdefault(it.section or "", []).append(it)
    for sec, label in _DOC_SECTION_LABELS.items():
        group = by_section.get(sec)
        if not group:
            continue
        p.append(f"{label}:")
        for it in group:
            detail = f" — {it.detail}" if it.detail else ""
            p.append(f"  - [{it.category}] {it.text}{detail}")
    if not items:
        p.append("  (no tasklist captured yet — rely on the meeting notes below)")
    if changes:
        p.append("\nOPEN CHANGE REQUESTS:")
        for c in changes:
            p.append(f"  - {c.title}: {c.description}" + (f" (impact: {c.impact})" if c.impact else ""))
    if tasks:
        p.append("\nWORK TASKS: " + "; ".join(f"{t.title} [{t.type}]" for t in tasks))
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
        f"CAPTURED BUILD (notes-driven plan + tasklist):\n{_full_build_context(build)}\n\n"
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


def _plan_summary(build) -> str:
    """Compact, notes-driven build context: narrative + the captured tasklist grouped
    by GHL section. Replaces the old blueprint-entity dump for SOP/QA/change steps."""
    items = list(build.action_items.filter(superseded=False))
    parts = [
        f"Build: {build.title}",
        f"Goals: {build.goals or 'not specified'}",
        f"Integrations: {build.integrations or 'none'}",
    ]
    if (build.memory_summary or "").strip():
        parts.append(f"Current state: {build.memory_summary}")
    by_section = {}
    for it in items:
        by_section.setdefault(it.section or "", []).append(it)
    for sec, label in _DOC_SECTION_LABELS.items():
        group = by_section.get(sec)
        if group:
            parts.append(f"{label}: " + "; ".join(it.text for it in group))
    return "\n".join(parts)


def run_brief_qa(build) -> dict:
    notes = "\n\n".join(build.meeting_notes.order_by("created_at").values_list("raw_text", flat=True))
    items = list(build.action_items.filter(superseded=False))
    task_lines = "\n".join(f"[{it.section or 'OTHER'}/{it.category}] {it.text}" for it in items) or "none"
    prompt = (
        "You are a QA reviewer for a GoHighLevel agency build. Compare the captured tasklist against "
        "the original meeting notes and flag anything the client requested that is MISSING from the "
        "tasklist, plus any delivery risks. The tasklist must faithfully cover the notes.\n\n"
        f"CAPTURED TASKLIST ({len(items)} items):\n{task_lines}\n\n"
        f"ORIGINAL MEETING NOTES:\n{notes[:MAX_TEXT_CHARS]}\n\n"
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
    context = _plan_summary(build)
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
    context = _plan_summary(build)
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
    items = list(build.action_items.filter(superseded=False))
    parts = [
        f"Overview: {build.overview or build.goals or 'n/a'}",
        f"Integrations: {build.integrations or 'none'}",
        f"Captured requests ({len(items)}): " + ("; ".join(it.text for it in items[:40]) or "none"),
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
    "newQuestions": _arr(_obj({   # open items raised → captured as QUESTION tasklist items
        "section": _enum(
            "PIPELINE", "AUTOMATIONS", "CLIENT_UPDATES", "LEAD_SOURCES", "CALENDARS",
            "INTEGRATIONS", "FIELDS_TAGS", "FORMS_PAYMENTS", "REPORTING_LAUNCH", "OTHER",
        ),
        "question": _str(),
        "rationale": _str(),
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


# ─── Meeting tasklist (source-faithful, exhaustive capture) ───────────────────
# A separate lens from the blueprint: the blueprint abstracts notes into an
# architecture (and can drop literal asks); this captures EVERY requested task /
# change / question verbatim, so staff have a checklist nothing slips out of.
_ACTION_ITEM_CATEGORIES = ("REQUEST", "CHANGE", "QUESTION", "DECISION", "INFO")
# GHL areas an item can belong to (mirrors models.BuildSection) + OTHER for items
# that don't map to one. OTHER is stored as "" (uncategorized) when persisted.
_ACTION_ITEM_SECTIONS = (
    "PIPELINE", "AUTOMATIONS", "CLIENT_UPDATES", "LEAD_SOURCES", "CALENDARS",
    "INTEGRATIONS", "FIELDS_TAGS", "FORMS_PAYMENTS", "REPORTING_LAUNCH", "OTHER",
)

_TASKLIST_SCHEMA = _obj({
    "items": _arr(_obj({
        "text": _str(),                       # the request, in the client's own words
        "detail": _str(),                     # short clarifying context, or ""
        "category": _enum(*_ACTION_ITEM_CATEGORIES),
        "section": _enum(*_ACTION_ITEM_SECTIONS),  # which GHL area it belongs to
    })),
})

_TASKLIST_RECONCILE_SCHEMA = _obj({
    "add": _arr(_obj({                         # genuinely new items raised this meeting
        "text": _str(),
        "detail": _str(),
        "category": _enum(*_ACTION_ITEM_CATEGORIES),
        "section": _enum(*_ACTION_ITEM_SECTIONS),
    })),
    "modify": _arr(_obj({                       # existing items whose scope changed
        "id": _int(),                          # id from the CURRENT LIST below
        "text": _str(),
        "detail": _str(),
        "category": _enum(*_ACTION_ITEM_CATEGORIES),
        "section": _enum(*_ACTION_ITEM_SECTIONS),
    })),
    "supersede": _arr(_obj({                    # existing items the client reversed/withdrew
        "id": _int(),
        "reason": _str(),
    })),
})

_TASKLIST_SYSTEM_PROMPT = (
    "You are a meticulous Go High Level (GHL) delivery analyst at Calari Solutions. Your job has two "
    "halves and the FIRST is paramount — COMPLETENESS: read the meeting notes and capture EVERY "
    "actionable request, change, open question, and explicit decision the client raised. This is a "
    "faithful record of THIS client's actual words, not a summary and not a template — do NOT merge "
    "distinct asks, do NOT omit small ones, do NOT invent requirements the client did not state, and do "
    "NOT bend the notes to fit a standard build. Keep each item in the client's own words. One item per "
    "distinct ask.\n\n"
    "The SECOND half is organization: tag each captured item with the nature (category) and the GHL area "
    "(section) it belongs to, using your knowledge of how Calari builds in GHL.\n"
    "- category: REQUEST (a new task/feature to build), CHANGE (a change to something already in scope), "
    "QUESTION (an open item needing an answer), DECISION (a choice the client confirmed), INFO (context "
    "worth recording but not actionable).\n"
    "- section: PIPELINE (stages/opportunity flow), AUTOMATIONS (workflows/sequences), CLIENT_UPDATES "
    "(new features & updates), LEAD_SOURCES (where contacts come from), CALENDARS (booking), INTEGRATIONS "
    "(external systems/data flow), FIELDS_TAGS (custom fields/values/tags), FORMS_PAYMENTS (forms/order "
    "forms/payments), REPORTING_LAUNCH (dashboards/QA/go-live), or OTHER if it genuinely fits none.\n"
    "Categorization must follow the notes — never force an item into a section it doesn't belong to. "
    "If the notes contain nothing actionable, return an empty list."
)


def _tasklist_reference(reference_text: str) -> list[dict]:
    """Optional Build-Library grounding message (how Calari builds), if available."""
    if not (reference_text or "").strip():
        return []
    return [{"role": "system", "content":
             "Reference — how Calari builds in GHL (use ONLY to categorize and phrase items well, "
             "never to add scope the client didn't ask for):\n" + reference_text[:8000]}]


def extract_meeting_tasklist(note_text: str, reference_text: str = "") -> dict:
    """First-meeting extraction: pull EVERY requested task/change/question/decision
    from the notes, verbatim and exhaustive, each tagged with category + GHL section.
    `reference_text` is optional Build-Library context. Returns {"items": [...]}."""
    raw = _chat(
        [
            {"role": "system", "content": _TASKLIST_SYSTEM_PROMPT},
            *_tasklist_reference(reference_text),
            {"role": "user", "content": f"Meeting notes:\n\n{note_text[:MAX_TEXT_CHARS]}\n\nReturn JSON matching the schema."},
        ],
        response_format={"type": "json_schema", "json_schema": {"name": "meeting_tasklist", "strict": True, "schema": _TASKLIST_SCHEMA}},
        op="tasklist",
    )
    return json.loads(raw) if raw else {"items": []}


def reconcile_meeting_tasklist(existing_items, note_text: str, reference_text: str = "") -> dict:
    """Subsequent-meeting reconciliation: diff the new notes against the CURRENT
    tasklist and return only the operations to apply — add (new asks), modify
    (changed scope, referenced by id), supersede (reversed/withdrawn asks, by id).
    Items not mentioned are kept untouched. `existing_items` is an iterable of
    MeetingActionItem. Returns {"add": [...], "modify": [...], "supersede": [...]}."""
    current = "\n".join(
        f"[{it.id}] ({it.category}/{it.section or 'OTHER'}) {it.text}" + (f" — {it.detail}" if it.detail else "")
        for it in existing_items
    ) or "(empty)"
    prompt = (
        "This is a FOLLOW-UP meeting on an in-flight build. You have the CURRENT tasklist (each line "
        "prefixed with its id) and NEW meeting notes. Diff them and return ONLY what changed:\n"
        "- add: genuinely new asks raised this meeting that are not already on the list.\n"
        "- modify: existing items (by id) whose scope the client changed — give the full updated text.\n"
        "- supersede: existing items (by id) the client reversed, withdrew, or replaced — with a short reason.\n"
        "Do NOT re-add items already on the list. Do NOT touch items the meeting did not mention. "
        "Be exhaustive about genuinely new asks — miss nothing. Tag each add/modify with category + section.\n\n"
        f"CURRENT TASKLIST:\n{current}\n\n"
        f"NEW MEETING NOTES:\n{note_text[:MAX_TEXT_CHARS]}\n\n"
        "Return JSON matching the schema."
    )
    raw = _chat(
        [
            {"role": "system", "content": _TASKLIST_SYSTEM_PROMPT},
            *_tasklist_reference(reference_text),
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_schema", "json_schema": {"name": "tasklist_reconcile", "strict": True, "schema": _TASKLIST_RECONCILE_SCHEMA}},
        op="tasklist_reconcile",
    )
    return json.loads(raw) if raw else {"add": [], "modify": [], "supersede": []}


# ─── Progress verification (audit staff work against the tasklist) ────────────
_PROGRESS_AUDIT_SCHEMA = _obj({
    "items": _arr(_obj({            # only items the report actually addresses
        "id": _int(),              # action item id from the CURRENT TASKLIST
        "status": _enum("OPEN", "IN_PROGRESS", "DONE"),
        "verification": _enum("VERIFIED", "NEEDS_INFO"),
        "evidence": _str(),        # what the report demonstrated for this item
        "note": _str(),            # pushback / what's missing or unclear (when NEEDS_INFO), else ""
    })),
    "newWork": _arr(_obj({          # completed work reported that's NOT already on the list
        "text": _str(),
        "detail": _str(),
        "category": _enum(*_ACTION_ITEM_CATEGORIES),
        "section": _enum(*_ACTION_ITEM_SECTIONS),
    })),
    "pushback": _arr(_str()),       # overall expert clarifications the staff must resolve
    "summary": _str(),
})

_PROGRESS_AUDIT_SYSTEM_PROMPT = (
    "You are a senior GoHighLevel (GHL) build auditor at Calari Solutions. A staff member has reported "
    "the work they've completed on an in-flight build. Your job is CRITICAL, FACTUAL VERIFICATION — not "
    "to take their word for it. Audit the report against the build tasklist and decide, item by item, "
    "whether the work is genuinely and CORRECTLY built.\n\n"
    "Be a strict expert. For every claimed element, the report must demonstrate the real mechanics, or "
    "you mark it NEEDS_INFO with a specific question:\n"
    "- Automation/workflow: exact trigger, the step-by-step actions, the outcome, and how it ENDS or "
    "MERGES with other workflows (stop conditions, re-entry, hand-off).\n"
    "- Form: its fields, where it lives (which funnel/step), and what it triggers on submit.\n"
    "- Funnel/landing page: steps, the conversion action, and what fires next.\n"
    "- Calendar: type, who it assigns to, what stage it books into, reminders.\n"
    "- Field/value/tag: its exact name and what sets/uses it.\n"
    "Mark VERIFIED only when the report shows the element is built correctly AND completely. If a claim "
    "is vague ('set up automation A'), mark NEEDS_INFO and ask exactly what's missing. If a tasklist "
    "item isn't mentioned in the report, OMIT it (leave it unchanged) — only return items the report "
    "addresses. List any reported-but-uncaptured completed work under newWork. Put the build-level gaps, "
    "risks, and missing pieces the staff must resolve under pushback. Be specific and uncompromising — "
    "an incorrect or half-built flow breaks the whole system."
)


def analyze_progress_report(build, report_text: str, reference_text: str = "") -> dict:
    """Audit a staff progress report against the build tasklist. Returns per-item
    status + verification verdicts (with pushback), newly-reported work, and overall
    expert clarifications. Does NOT mutate the DB — the caller applies the result."""
    items = list(build.action_items.filter(superseded=False))
    current = "\n".join(
        f"[{it.id}] ({it.section or 'OTHER'}/{it.category}) {it.text}"
        + (f" — {it.detail}" if it.detail else "")
        + (f" [status: {it.status}]" if it.status != "OPEN" else "")
        for it in items
    ) or "(empty — nothing captured yet)"
    messages = [{"role": "system", "content": _PROGRESS_AUDIT_SYSTEM_PROMPT}]
    if (reference_text or "").strip():
        messages.append({"role": "system", "content":
                         "Reference — how Calari builds in GHL (use to judge correctness):\n"
                         + reference_text[:8000]})
    messages.append({"role": "user", "content": (
        "Audit this progress report against the tasklist.\n\n"
        f"BUILD TASKLIST (each line prefixed with its id):\n{current}\n\n"
        f"STAFF PROGRESS REPORT:\n{report_text[:MAX_TEXT_CHARS]}\n\n"
        "Return JSON matching the schema."
    )})
    raw = _chat(
        messages,
        response_format={"type": "json_schema", "json_schema": {"name": "progress_audit", "strict": True, "schema": _PROGRESS_AUDIT_SCHEMA}},
        model=_blueprint_model(), op="progress_audit",
    )
    return json.loads(raw) if raw else {"items": [], "newWork": [], "pushback": [], "summary": ""}


# ─── Client handover document (end of build, AI-written from history) ──────────
_CLIENT_HANDOVER_SYSTEM_PROMPT = (
    "You are a senior GoHighLevel solutions consultant at Calari Solutions writing the CLIENT-FACING "
    "handover document for a completed build. Audience is the client (a business owner), not an "
    "engineer — clear, confident, and benefit-led, but concrete about what was built and how to operate "
    "it. Base it ONLY on the build's captured tasklist, meeting notes, and progress history provided; do "
    "not invent features that weren't built. Output GitHub-flavored Markdown with these sections:\n"
    "1. Overview — what the system does and the goal it serves\n"
    "2. What we built — the delivered components grouped by area (pipeline, automations, calendars, "
    "lead sources, forms/payments, integrations, fields & tags, reporting), in plain language\n"
    "3. How leads flow through the system — the end-to-end journey\n"
    "4. How to operate it day-to-day — what the client does vs what runs automatically\n"
    "5. Reporting — what to watch and where\n"
    "6. Maintenance & support — what needs occasional attention, who to contact\n"
    "7. What's next / recommendations — sensible future improvements\n"
    "Return ONLY the Markdown document."
)


def generate_client_handover(build, reference_text: str = "") -> str:
    """Generate the client-facing handover document from the build's tasklist, notes,
    and progress history (end of build). Returns Markdown."""
    notes = "\n\n".join(build.meeting_notes.order_by("created_at").values_list("raw_text", flat=True))
    reports = build.progress_reports.order_by("created_at")
    progress = "\n\n".join(f"[{r.created_at:%Y-%m-%d}] {r.summary or r.raw_text[:1000]}" for r in reports)
    messages = [{"role": "system", "content": _CLIENT_HANDOVER_SYSTEM_PROMPT}]
    messages.append({"role": "user", "content": (
        f"CAPTURED BUILD (delivered plan):\n{_full_build_context(build)}\n\n"
        f"PROGRESS HISTORY:\n{progress[:MAX_TEXT_CHARS] or 'n/a'}\n\n"
        f"ORIGINAL MEETING NOTES:\n{notes[:MAX_TEXT_CHARS]}"
    )})
    doc = (_chat(messages, model=_blueprint_model(), max_tokens=16000, op="client_handover") or "").strip()
    if not doc:
        raise RuntimeError("AI returned no handover content")
    return doc


# ─── Handover render (blueprint → client handover markdown) ───────────────────


# ─── Meeting tasklist export ──────────────────────────────────────────────────
_ACTION_CATEGORY_LABELS = {
    "REQUEST": "Request", "CHANGE": "Change", "QUESTION": "Question",
    "DECISION": "Decision", "INFO": "Info",
}
_ACTION_STATUS_LABELS = {
    "OPEN": "Open", "IN_PROGRESS": "In progress", "DONE": "Done", "DROPPED": "Dropped",
}
# GHL-section display order + labels for the grouped checklist (mirrors BuildSection).
_ACTION_SECTION_LABELS = [
    ("PIPELINE", "Pipeline"),
    ("AUTOMATIONS", "Automations"),
    ("CLIENT_UPDATES", "New features & updates"),
    ("LEAD_SOURCES", "Lead sources"),
    ("CALENDARS", "Calendars"),
    ("INTEGRATIONS", "Integrations"),
    ("FIELDS_TAGS", "Fields & tags"),
    ("FORMS_PAYMENTS", "Forms & payments"),
    ("REPORTING_LAUNCH", "Reporting & launch"),
    ("", "Other / uncategorized"),
]


def render_tasklist_markdown(build) -> str:
    """Render the build's reconciled tasklist as a staff checklist grouped by GHL
    section — a purely notes-driven plan, organized into familiar GHL areas."""
    items = [i for i in build.action_items.all() if not i.superseded]
    out: list[str] = [f"# {build.title} — Build Tasklist"]
    if build.client_id:
        out.append(f"\n*Client: {build.client.name}*")
    out.append(f"\n*{len(items)} item(s) captured from meeting notes.*\n")
    for sec, label in _ACTION_SECTION_LABELS:
        group = [i for i in items if (i.section or "") == sec]
        if not group:
            continue
        out.append(f"\n## {label}\n")
        for it in group:
            box = "[x]" if it.status == "DONE" else "[ ]"
            cat = f" `[{_ACTION_CATEGORY_LABELS.get(it.category, it.category)}]`"
            status = "" if it.status in ("OPEN", "DONE") else f" `({_ACTION_STATUS_LABELS.get(it.status, it.status)})`"
            tail = f" — _{it.detail}_" if it.detail else ""
            out.append(f"- {box}{cat} {it.text}{status}{tail}")
    superseded = [i for i in build.action_items.all() if i.superseded]
    if superseded:
        out.append("\n## Superseded (no longer in scope)\n")
        for it in superseded:
            reason = f" — {it.superseded_reason}" if it.superseded_reason else ""
            out.append(f"- ~~{it.text}~~{reason}")
    return "\n".join(out) + "\n"


def render_tasklist_csv(build) -> str:
    """Render the tasklist as CSV for staff to sort/assign in a spreadsheet."""
    import csv
    section_labels = dict(_ACTION_SECTION_LABELS)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Section", "Category", "Item", "Detail", "Status", "Superseded", "Superseded reason"])
    for it in build.action_items.all():
        w.writerow([
            section_labels.get(it.section or "", it.section),
            _ACTION_CATEGORY_LABELS.get(it.category, it.category),
            it.text,
            it.detail,
            _ACTION_STATUS_LABELS.get(it.status, it.status),
            "yes" if it.superseded else "",
            it.superseded_reason,
        ])
    return buf.getvalue()


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
    try:
        from django.core.files.storage import default_storage
        return default_storage.url(key)
    except Exception:  # noqa: BLE001
        pass
    bucket = settings.AWS_STORAGE_BUCKET_NAME
    if settings.AWS_S3_ENDPOINT_URL:
        return f"{settings.AWS_S3_ENDPOINT_URL}/{bucket}/{key}"
    return f"https://{bucket}.s3.{settings.AWS_S3_REGION_NAME}.amazonaws.com/{key}"


def validate_uploaded_object(key: str, content_type: str = "", size_bytes=None) -> tuple[bool, str]:
    """Confirm a presigned PUT object exists before recording it in the database."""
    if not settings.AWS_STORAGE_BUCKET_NAME:
        return False, "S3 storage is not configured."
    try:
        meta = _s3_client().head_object(Bucket=settings.AWS_STORAGE_BUCKET_NAME, Key=key)
    except Exception:  # noqa: BLE001
        return False, "Uploaded object was not found in storage."
    try:
        expected_size = int(size_bytes) if size_bytes not in (None, "") else None
    except (TypeError, ValueError):
        return False, "Invalid file size."
    actual_size = meta.get("ContentLength")
    if expected_size is not None and actual_size is not None and expected_size != actual_size:
        return False, "Uploaded object size does not match the finalized file."
    stored_type = (meta.get("ContentType") or "").split(";")[0].strip().lower()
    expected_type = (content_type or "").split(";")[0].strip().lower()
    if expected_type and stored_type and expected_type != stored_type:
        return False, "Uploaded object content type does not match the finalized file."
    return True, ""


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
