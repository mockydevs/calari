"""Onboarding Intelligence — service logic. Reuses builds' encryption + AI core."""
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
    """Decrypted access token / API key for the active connection, or None."""
    conn = get_active_connection(provider)
    if not conn:
        return None
    try:
        return decrypt_secret(conn.encrypted_secret)
    except Exception:  # noqa: BLE001
        return None


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
