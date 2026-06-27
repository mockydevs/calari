"""Onboarding Intelligence — service logic. Reuses builds' encryption + AI core."""
import json

from builds import services as ai

from .models import Connection, IntegrationMap


# ─── Secret crypto (reuse builds' AES-256-GCM + scrypt) ───────────────────────
def encrypt_secret(plaintext: str) -> tuple[str, str]:
    """Returns (encrypted, preview)."""
    return ai.encrypt_api_key(plaintext)


def decrypt_secret(encrypted: str) -> str:
    return ai.decrypt_api_key(encrypted)


# ─── Connection access ────────────────────────────────────────────────────────
def get_active_connection(provider: str) -> Connection | None:
    return Connection.objects.filter(provider=provider, active=True).order_by("-updated_at").first()


def get_provider_secret(provider: str) -> str | None:
    """Decrypted access token / API key for the active connection, or None. For OAuth
    connections, transparently refreshes an expired access token first."""
    conn = get_active_connection(provider)
    if not conn:
        return None
    if conn.auth_type == "oauth" and conn.expires_at and conn.encrypted_refresh:
        from django.utils import timezone
        if conn.expires_at <= timezone.now():
            try:
                _refresh_connection(conn)
            except Exception:  # noqa: BLE001 — fall through to the (possibly stale) token
                pass
    try:
        return decrypt_secret(conn.encrypted_secret)
    except Exception:  # noqa: BLE001
        return None


def _epoch_to_dt(epoch):
    if not epoch:
        return None
    from datetime import datetime, timezone as _dtz
    return datetime.fromtimestamp(epoch, tz=_dtz.utc)


def _refresh_connection(conn) -> None:
    """Refresh an OAuth connection's access token in place."""
    from . import oauth
    data = oauth.refresh(conn.provider, decrypt_secret(conn.encrypted_refresh))
    enc, preview = encrypt_secret(data["access_token"])
    conn.encrypted_secret = enc
    conn.secret_preview = preview
    if data.get("refresh_token"):
        conn.encrypted_refresh = encrypt_secret(data["refresh_token"])[0]
    conn.expires_at = _epoch_to_dt(data.get("expires_at"))
    conn.save(update_fields=["encrypted_secret", "secret_preview", "encrypted_refresh", "expires_at", "updated_at"])


def save_oauth_connection(provider: str, token_data: dict, user=None):
    """Upsert the active OAuth connection for a provider from a token exchange result."""
    enc, preview = encrypt_secret(token_data["access_token"])
    Connection.objects.filter(provider=provider, active=True).update(active=False)
    return Connection.objects.create(
        provider=provider, auth_type="oauth", label=f"{provider} (OAuth)",
        encrypted_secret=enc, secret_preview=preview,
        encrypted_refresh=(encrypt_secret(token_data["refresh_token"])[0] if token_data.get("refresh_token") else ""),
        scopes=token_data.get("scope", ""), expires_at=_epoch_to_dt(token_data.get("expires_at")),
        workspace_ref=token_data.get("workspace_ref", ""), active=True, created_by=user,
    )


# ─── Identity resolution (Fireflies call → client) ────────────────────────────
def resolve_client_map(participant_emails) -> IntegrationMap | None:
    """Resolve a call to a single client via its IntegrationMap. Conservative: a
    confident single match only — misattributing a call to the wrong client is the
    worst failure mode, so ambiguity returns None (the caller logs + skips).

    Order: (1) exact known-participant email, (2) unique email-domain match.
    """
    emails = {(e or "").strip().lower() for e in (participant_emails or []) if e}
    if not emails:
        return None
    domains = {e.split("@")[-1] for e in emails if "@" in e}

    maps = list(IntegrationMap.objects.filter(active=True))

    # 1. Exact participant-email match (strongest signal).
    for m in maps:
        if emails & set(m.emails()):
            return m

    # 2. Unique domain match (only if exactly one client owns the domain).
    domain_hits = [m for m in maps if domains & set(m.domains())]
    if len(domain_hits) == 1:
        return domain_hits[0]

    return None


# ─── AI ops (reuse builds' _chat + schema helpers) ────────────────────────────
_num = {"type": "number"}

_INSIGHT_SCHEMA = ai._obj({
    "summary": ai._str(),
    "needs": ai._arr(ai._str()),
    "pain_points": ai._arr(ai._str()),
    "services_mentioned": ai._arr(ai._str()),
    "action_items": ai._arr(ai._obj({"title": ai._str(), "detail": ai._str()})),
    "sentiment": ai._enum("positive", "neutral", "negative", "mixed"),
    "risks": ai._arr(ai._str()),
    "upsell_signals": ai._arr(ai._str()),
    "internal_summary": ai._str(),   # full detail for the team's internal channel
    "external_summary": ai._str(),   # client-appropriate recap for the shared channel
    "confidence": _num,              # 0..1 — how reliably the call was understood
})

_INSIGHT_SYSTEM_PROMPT = (
    "You are a senior marketing & CRM strategist at Calari Solutions analyzing a client "
    "onboarding call transcript. Extract the COMPLETE picture so nothing is lost in the "
    "handoff — needs, pain points, services discussed, explicit commitments/action items, "
    "sentiment, risks, and upsell signals (services the client could benefit from but "
    "hasn't bought). Then write two recaps:\n"
    "- internal_summary: detailed, candid, for the delivery team (internal Slack).\n"
    "- external_summary: a warm, professional, client-appropriate recap for the shared "
    "channel — NO internal notes, NO pricing/strategy we haven't told the client, NO "
    "commitments we didn't actually make.\n"
    "Set confidence (0..1) by how clearly the transcript supported your extraction "
    "(short/garbled/ambiguous calls → low). Base everything strictly on the transcript."
)


def analyze_call(transcript: str, client_name: str = "", prior_context: str = "") -> dict:
    """Marketing-expert insight extraction from a call transcript. Returns the structured
    insight dict (incl. internal/external summaries + confidence)."""
    user = ""
    if client_name:
        user += f"CLIENT: {client_name}\n"
    if prior_context.strip():
        user += f"PRIOR CONTEXT (earlier calls with this client):\n{prior_context[:6000]}\n\n"
    user += f"CALL TRANSCRIPT:\n{transcript[:ai.MAX_TEXT_CHARS]}\n\nReturn JSON matching the schema."
    raw = ai._chat(
        [{"role": "system", "content": _INSIGHT_SYSTEM_PROMPT}, {"role": "user", "content": user}],
        response_format={"type": "json_schema", "json_schema": {"name": "call_insight", "strict": True, "schema": _INSIGHT_SCHEMA}},
        model=ai._blueprint_model(), op="onboarding_insight",
    )
    return json.loads(raw) if raw else {}


_GUARDRAIL_SCHEMA = ai._obj({"ok": ai._bool(), "reason": ai._str()})


def guardrail_check(text: str) -> dict:
    """Cheap safety pass before posting a client-facing message. ok=False blocks it."""
    raw = ai._chat(
        [
            {"role": "system", "content": (
                "You are a brand-safety reviewer at Calari Solutions. Decide if the following "
                "message is safe to post to a CLIENT-FACING Slack channel. Set ok=false if it "
                "leaks internal notes/strategy, exposes PII, states pricing or commitments we "
                "may not have made, or is unprofessional/off-brand. Otherwise ok=true. Give a "
                "short reason."
            )},
            {"role": "user", "content": text[:8000] + "\n\nReturn JSON matching the schema."},
        ],
        response_format={"type": "json_schema", "json_schema": {"name": "guardrail", "strict": True, "schema": _GUARDRAIL_SCHEMA}},
        op="onboarding_guardrail",
    )
    try:
        return json.loads(raw) if raw else {"ok": False, "reason": "no guardrail response"}
    except Exception:  # noqa: BLE001
        return {"ok": False, "reason": "guardrail parse error"}


_UPSELL_SCHEMA = ai._obj({
    "suggestions": ai._arr(ai._obj({
        "service": ai._str(),
        "rationale": ai._str(),
        "confidence": ai._enum("high", "medium", "low"),
    })),
})


def suggest_upsell(client_name: str, insight_history: str) -> dict:
    """Predictive upsell: mine a client's accumulated call insights for next services."""
    raw = ai._chat(
        [
            {"role": "system", "content": (
                "You are a senior account strategist at Calari Solutions. Based on a client's "
                "accumulated call insights, propose the next services/products to proactively "
                "offer — each with a concrete rationale grounded in what they've said and a "
                "confidence. Only suggest what the insights actually support; no generic upsells."
            )},
            {"role": "user", "content": f"CLIENT: {client_name}\n\nINSIGHT HISTORY:\n{insight_history[:ai.MAX_TEXT_CHARS]}\n\nReturn JSON matching the schema."},
        ],
        response_format={"type": "json_schema", "json_schema": {"name": "upsell", "strict": True, "schema": _UPSELL_SCHEMA}},
        op="onboarding_upsell",
    )
    return json.loads(raw) if raw else {"suggestions": []}
