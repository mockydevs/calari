"""Thin HTTP clients for the external integrations, built on httpx (no extra deps).

Each call pulls the active provider token from the encrypted `Connection` store via
services.get_provider_secret(). If a provider isn't connected, a clear
`IntegrationError` is raised so the caller can log a `skipped` event and move on —
nothing here crashes the pipeline.
"""
import json

import httpx

from . import services

_TIMEOUT = 30.0


class IntegrationError(Exception):
    """A provider call failed or the provider isn't connected."""


def _token(provider: str) -> str:
    secret = services.get_provider_secret(provider)
    if not secret:
        raise IntegrationError(f"{provider} is not connected (add a token in Settings → Integrations).")
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
    token = _token("GDRIVE")
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
