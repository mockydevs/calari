"""Thin HTTP clients for the external integrations, built on httpx (no extra deps).

Each call pulls the active provider token from the encrypted `Connection` store via
services.get_provider_secret(). If a provider isn't connected, a clear
`IntegrationError` is raised so the caller can log a `skipped` event and move on —
nothing here crashes the pipeline.
"""
import json

import httpx

from . import services, oauth

_TIMEOUT = 30.0


class IntegrationError(Exception):
    """A provider call failed or the provider isn't connected."""


def _token(provider: str) -> str:
    secret = services.get_provider_secret(provider)
    if not secret:
        raise IntegrationError(f"{provider} is not connected (add a token in Settings → Integrations).")
    return secret


def _looks_like_service_account(secret: str) -> bool:
    s = (secret or "").strip()
    return s.startswith("{") and '"private_key"' in s and '"client_email"' in s


def _gdrive_token() -> str:
    """Bearer token for Google. Accepts either a stored OAuth access token OR a
    service-account JSON (minted to a short-lived token via the JWT-bearer flow)."""
    secret = services.get_provider_secret("GDRIVE")
    if not secret:
        raise IntegrationError("Google Drive is not connected (add a token in Settings → Integrations).")
    if _looks_like_service_account(secret):
        try:
            return oauth.service_account_access_token(json.loads(secret), oauth.PROVIDERS["GDRIVE"]["scopes"])
        except Exception as e:  # noqa: BLE001
            raise IntegrationError(f"Google service-account auth failed: {e}")
    return secret


# ─── Fireflies (GraphQL) ───────────────────────────────────────────────────────
_FIREFLIES_URL = "https://api.fireflies.ai/graphql"
_FIREFLIES_QUERY = """
query Transcript($id: String!) {
  transcript(id: $id) {
    id title date transcript_url
    sentences { text speaker_name }
    meeting_attendees { displayName email }
  }
}
"""


def fireflies_transcript(call_id: str) -> dict:
    """Fetch a transcript: returns {title, date, url, text, participants[]}."""
    token = _token("FIREFLIES")
    try:
        r = httpx.post(
            _FIREFLIES_URL,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"query": _FIREFLIES_QUERY, "variables": {"id": call_id}},
            timeout=_TIMEOUT,
        )
    except httpx.HTTPError as e:
        raise IntegrationError(f"Fireflies request failed: {e}")
    if r.status_code >= 400:
        raise IntegrationError(f"Fireflies error {r.status_code}: {r.text[:300]}")
    data = (r.json() or {}).get("data", {}).get("transcript")
    if not data:
        raise IntegrationError("Fireflies returned no transcript for that id.")
    sentences = data.get("sentences") or []
    text = "\n".join(
        f"{(s.get('speaker_name') or '').strip()}: {s.get('text', '')}".strip(": ").strip()
        for s in sentences if s.get("text")
    )
    attendees = data.get("meeting_attendees") or []
    participants = [
        {"name": a.get("displayName") or "", "email": (a.get("email") or "").lower()}
        for a in attendees
    ]
    return {
        "title": data.get("title") or "",
        "date": data.get("date"),
        "url": data.get("transcript_url") or "",
        "text": text,
        "participants": participants,
    }


# ─── Slack ─────────────────────────────────────────────────────────────────────
def slack_post(channel_id: str, text: str) -> str:
    """Post a message; returns the message ts (for threading / retraction)."""
    token = _token("SLACK")
    try:
        r = httpx.post(
            "https://slack.com/api/chat.postMessage",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"},
            json={"channel": channel_id, "text": text, "unfurl_links": False},
            timeout=_TIMEOUT,
        )
    except httpx.HTTPError as e:
        raise IntegrationError(f"Slack request failed: {e}")
    body = r.json() if r.content else {}
    if not body.get("ok"):
        raise IntegrationError(f"Slack error: {body.get('error', r.status_code)}")
    return body.get("ts", "")


def slack_delete(channel_id: str, ts: str) -> None:
    token = _token("SLACK")
    httpx.post(
        "https://slack.com/api/chat.delete",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"},
        json={"channel": channel_id, "ts": ts}, timeout=_TIMEOUT,
    )


# ─── Asana ─────────────────────────────────────────────────────────────────────
def asana_create_task(project_gid: str, name: str, notes: str = "") -> str:
    """Create a task in a project; returns the task gid."""
    token = _token("ASANA")
    try:
        r = httpx.post(
            "https://app.asana.com/api/1.0/tasks",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"data": {"name": name[:1024], "notes": notes, "projects": [project_gid]}},
            timeout=_TIMEOUT,
        )
    except httpx.HTTPError as e:
        raise IntegrationError(f"Asana request failed: {e}")
    if r.status_code >= 400:
        raise IntegrationError(f"Asana error {r.status_code}: {r.text[:300]}")
    return ((r.json() or {}).get("data") or {}).get("gid", "")


def asana_delete_task(task_gid: str) -> None:
    token = _token("ASANA")
    httpx.delete(
        f"https://app.asana.com/api/1.0/tasks/{task_gid}",
        headers={"Authorization": f"Bearer {token}"}, timeout=_TIMEOUT,
    )


# ─── Google Docs (enrich the onboarding doc) ───────────────────────────────────
# The stored GDRIVE token must be an OAuth access token with documents scope.
# (Service-account JWT exchange is a later enhancement.)
def gdocs_append(doc_id: str, text: str) -> str:
    """Append text to the end of a Google Doc; returns a marker string."""
    token = _gdrive_token()
    url = f"https://docs.googleapis.com/v1/documents/{doc_id}:batchUpdate"
    body = {"requests": [{"insertText": {"endOfSegmentLocation": {}, "text": text}}]}
    try:
        r = httpx.post(url, headers={"Authorization": f"Bearer {token}",
                                     "Content-Type": "application/json"},
                       content=json.dumps(body), timeout=_TIMEOUT)
    except httpx.HTTPError as e:
        raise IntegrationError(f"Google Docs request failed: {e}")
    if r.status_code >= 400:
        raise IntegrationError(f"Google Docs error {r.status_code}: {r.text[:300]}")
    return f"doc:{doc_id}"


# ─── Connection test (cheap authenticated ping per provider) ───────────────────
def test_connection(provider: str, token: str) -> tuple[bool, str]:
    """Validate a token with a lightweight authenticated call. Returns (ok, detail).
    Never raises — a failure is reported as (False, reason)."""
    if not token:
        return False, "No token stored."
    # Google may be a service-account JSON — mint a real bearer token to test it.
    if provider == "GDRIVE" and _looks_like_service_account(token):
        try:
            token = oauth.service_account_access_token(json.loads(token), oauth.PROVIDERS["GDRIVE"]["scopes"])
        except Exception as e:  # noqa: BLE001
            return False, f"Service-account auth failed: {e}"
    auth = {"Authorization": f"Bearer {token}"}
    try:
        if provider == "SLACK":
            r = httpx.post("https://slack.com/api/auth.test", headers=auth, timeout=_TIMEOUT)
            b = r.json() if r.content else {}
            if b.get("ok"):
                return True, f"Connected as {b.get('user', '?')} in {b.get('team', '?')}."
            return False, f"Slack: {b.get('error', r.status_code)}"

        if provider == "ASANA":
            r = httpx.get("https://app.asana.com/api/1.0/users/me", headers=auth, timeout=_TIMEOUT)
            if r.status_code == 200:
                name = ((r.json() or {}).get("data") or {}).get("name", "?")
                return True, f"Connected as {name}."
            return False, f"Asana error {r.status_code}: {r.text[:160]}"

        if provider == "FIREFLIES":
            r = httpx.post("https://api.fireflies.ai/graphql", headers={**auth, "Content-Type": "application/json"},
                           json={"query": "{ user { name } }"}, timeout=_TIMEOUT)
            b = r.json() if r.content else {}
            if r.status_code == 200 and not b.get("errors"):
                name = ((b.get("data") or {}).get("user") or {}).get("name", "ok")
                return True, f"Connected ({name})."
            err = (b.get("errors") or [{}])[0].get("message") if b.get("errors") else r.status_code
            return False, f"Fireflies: {err}"

        if provider == "GDRIVE":
            r = httpx.get("https://www.googleapis.com/drive/v3/about",
                          params={"fields": "user", "supportsAllDrives": "true"}, headers=auth, timeout=_TIMEOUT)
            if r.status_code == 200:
                email = ((r.json() or {}).get("user") or {}).get("emailAddress", "ok")
                return True, f"Connected as {email}."
            return False, f"Google error {r.status_code}: {r.text[:160]}"

        return False, "Unknown provider."
    except httpx.HTTPError as e:
        return False, f"Request failed: {e}"
