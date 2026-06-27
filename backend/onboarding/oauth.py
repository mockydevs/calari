"""OAuth 2.0 connect flows for Slack, Asana, and Google (Drive/Docs).

Flow (fits the BFF/JWT setup without needing Django auth on the callback):
  1. Frontend asks the authenticated `authorize-url` endpoint for a provider URL.
     The endpoint returns the provider's authorize URL with a SIGNED `state`
     (provider + user id, HMAC-signed via Django's signer, 10-min TTL).
  2. Browser navigates to the provider, user consents, provider redirects to the
     PUBLIC callback with ?code&state. The callback verifies the signed state
     (no session needed), exchanges the code for tokens, upserts the Connection,
     and 302s back to the frontend.

Fireflies is API-key only (no OAuth) — not handled here.
"""
import os
import time
from urllib.parse import urlencode

import httpx
from django.core import signing

_SIGNER_SALT = "onboarding-oauth-state"
_STATE_TTL = 600  # seconds
_TIMEOUT = 30.0

# Per-provider OAuth config. client id/secret come from env.
PROVIDERS = {
    "SLACK": {
        "authorize_url": "https://slack.com/oauth/v2/authorize",
        "token_url": "https://slack.com/api/oauth.v2.access",
        "scopes": "chat:write,channels:read,groups:read",  # bot scopes
        "client_id_env": "SLACK_CLIENT_ID",
        "client_secret_env": "SLACK_CLIENT_SECRET",
        "refreshable": False,
    },
    "ASANA": {
        "authorize_url": "https://app.asana.com/-/oauth_authorize",
        "token_url": "https://app.asana.com/-/oauth_token",
        "scopes": "default",
        "client_id_env": "ASANA_CLIENT_ID",
        "client_secret_env": "ASANA_CLIENT_SECRET",
        "refreshable": True,
    },
    "GDRIVE": {
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "scopes": os.getenv(
            "GOOGLE_OAUTH_SCOPES",
            "https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive.file",
        ),
        "client_id_env": "GOOGLE_CLIENT_ID",
        "client_secret_env": "GOOGLE_CLIENT_SECRET",
        "refreshable": True,
    },
}


class OAuthError(Exception):
    pass


def is_supported(provider: str) -> bool:
    return provider in PROVIDERS


def is_configured(provider: str) -> bool:
    cfg = PROVIDERS.get(provider)
    return bool(cfg and os.getenv(cfg["client_id_env"]) and os.getenv(cfg["client_secret_env"]))


def _client(provider: str) -> tuple[str, str]:
    cfg = PROVIDERS[provider]
    cid, secret = os.getenv(cfg["client_id_env"]), os.getenv(cfg["client_secret_env"])
    if not cid or not secret:
        raise OAuthError(f"{provider} OAuth is not configured (set {cfg['client_id_env']} / {cfg['client_secret_env']}).")
    return cid, secret


def sign_state(provider: str, user_id) -> str:
    return signing.TimestampSigner(salt=_SIGNER_SALT).sign(f"{provider}:{user_id}")


def unsign_state(state: str) -> tuple[str, str]:
    raw = signing.TimestampSigner(salt=_SIGNER_SALT).unsign(state, max_age=_STATE_TTL)
    provider, user_id = raw.split(":", 1)
    return provider, user_id


def authorize_url(provider: str, state: str, redirect_uri: str) -> str:
    cfg = PROVIDERS[provider]
    cid, _ = _client(provider)
    params = {"client_id": cid, "redirect_uri": redirect_uri, "state": state, "scope": cfg["scopes"]}
    if provider == "SLACK":
        pass  # Slack omits response_type
    else:
        params["response_type"] = "code"
    if provider == "GDRIVE":
        params["access_type"] = "offline"
        params["prompt"] = "consent"
        params["include_granted_scopes"] = "true"
    return f"{cfg['authorize_url']}?{urlencode(params)}"


def _normalize(provider: str, body: dict) -> dict:
    """→ {access_token, refresh_token, expires_at, scope, workspace_ref}."""
    expires_in = body.get("expires_in")
    out = {
        "access_token": body.get("access_token", ""),
        "refresh_token": body.get("refresh_token", ""),
        "expires_at": (time.time() + expires_in) if expires_in else None,
        "scope": body.get("scope", ""),
        "workspace_ref": "",
    }
    if provider == "SLACK":
        out["workspace_ref"] = (body.get("team") or {}).get("id", "")
    return out


def exchange_code(provider: str, code: str, redirect_uri: str) -> dict:
    cfg = PROVIDERS[provider]
    cid, secret = _client(provider)
    data = {"client_id": cid, "client_secret": secret, "code": code, "redirect_uri": redirect_uri}
    if provider != "SLACK":
        data["grant_type"] = "authorization_code"
    try:
        r = httpx.post(cfg["token_url"], data=data, timeout=_TIMEOUT)
    except httpx.HTTPError as e:
        raise OAuthError(f"{provider} token request failed: {e}")
    body = r.json() if r.content else {}
    if provider == "SLACK" and not body.get("ok"):
        raise OAuthError(f"Slack OAuth: {body.get('error', r.status_code)}")
    if r.status_code >= 400 or not body.get("access_token"):
        raise OAuthError(f"{provider} token exchange failed: {body.get('error', r.status_code)}")
    return _normalize(provider, body)


def refresh(provider: str, refresh_token: str) -> dict:
    cfg = PROVIDERS[provider]
    if not cfg["refreshable"] or not refresh_token:
        raise OAuthError(f"{provider} tokens are not refreshable.")
    cid, secret = _client(provider)
    data = {"client_id": cid, "client_secret": secret, "grant_type": "refresh_token", "refresh_token": refresh_token}
    try:
        r = httpx.post(cfg["token_url"], data=data, timeout=_TIMEOUT)
    except httpx.HTTPError as e:
        raise OAuthError(f"{provider} refresh failed: {e}")
    body = r.json() if r.content else {}
    if r.status_code >= 400 or not body.get("access_token"):
        raise OAuthError(f"{provider} refresh failed: {body.get('error', r.status_code)}")
    return _normalize(provider, body)
