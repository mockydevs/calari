"""Separate, read-only Slack user grant. Live connection is an explicit final step."""
import base64
import hashlib
import os
import re
import secrets
import time
import uuid
from datetime import timedelta
from urllib.parse import urlencode

import requests
import json
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.http import HttpResponseRedirect
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from common.permissions import IsManager
from builds.permissions import is_manager
from projects.ghl_context import evidence
from .mcp import Client, McpError
from .models import SlackContextGrant, SlackOAuthAttempt, SlackIntakeSettings, ClientInvestigation
from .services import encrypt_secret, decrypt_secret

SCOPES = ["search:read.public", "search:read.private", "channels:history", "groups:history"]
# Only reviewed names may be used. An unrecognized live schema fails closed;
# final Slack integration includes verifying these against its actual catalogue.
SEARCH_TOOL = "slack_search_messages"
SEARCH_SCHEMA = {"query": "string"}


def configured():
    return all(os.getenv(key) for key in ("SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_APP_ID", "SLACK_CONTEXT_REDIRECT_URI"))


def token_request(data):
    try:
        response = requests.post("https://slack.com/api/oauth.v2.user.access", data=data,
                                 auth=(os.getenv("SLACK_CLIENT_ID", ""), os.getenv("SLACK_CLIENT_SECRET", "")),
                                 timeout=(3, 10), allow_redirects=False)
        if response.status_code != 200 or len(response.content) > 65536:
            raise McpError("Slack authorization failed.")
        result = response.json()
        if not isinstance(result, dict) or not result.get("ok") or not result.get("access_token"):
            raise McpError("Slack authorization failed. Check app approval, scopes and redirect URL.")
        return result
    except (requests.RequestException, ValueError):
        raise McpError("Slack authorization is unavailable.") from None


def revoke():
    from .investigations import invalidate
    with transaction.atomic():
        SlackContextGrant.objects.filter(pk=1).update(active=False, encrypted_token="", encrypted_refresh="", revision=uuid.uuid4(), capabilities={}, refresh_lease=None, refresh_lease_until=None)
        invalidate(ClientInvestigation.objects.filter(channel__isnull=False), "Slack context authorization was removed. Derived context and drafts were cleared.")


@api_view(["GET", "DELETE"])
@permission_classes([IsManager])
def connection_view(request):
    if request.method == "DELETE":
        revoke()
    grant = SlackContextGrant.objects.filter(pk=1).first()
    return Response({"app_configured": configured(), "connected": bool(grant and grant.active),
                     "workspace_id": grant.workspace_id if grant and grant.active else "",
                     "user_id": grant.slack_user_id if grant and grant.active else "",
                     "scopes": grant.scopes if grant and grant.active else [],
                     "capabilities": grant.capabilities if grant and grant.active else {},
                     "redirect_uri": os.getenv("SLACK_CONTEXT_REDIRECT_URI", ""),
                     "note": "Separate user authorization; no chat:write scope, no DMs, no external sends."})


@api_view(["POST"])
@permission_classes([IsManager])
def authorize(request):
    if not configured():
        return Response({"error": "Configure the registered Slack app ID, client ID/secret and context callback URL first."}, status=400)
    config = SlackIntakeSettings.objects.filter(pk=1).first()
    if not config or not config.workspace_id or not config.clare_user_id:
        return Response({"error": "Configure the intended workspace and Clare's Slack user ID first."}, status=400)
    nonce, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    SlackOAuthAttempt.objects.filter(expires_at__lt=timezone.now()).delete()
    SlackOAuthAttempt.objects.create(nonce=nonce, user=request.user, encrypted_verifier=encrypt_secret(verifier)[0], expires_at=timezone.now() + timedelta(minutes=10))
    query = {"client_id": os.environ["SLACK_CLIENT_ID"], "scope": ",".join(SCOPES), "redirect_uri": os.environ["SLACK_CONTEXT_REDIRECT_URI"],
             "response_type": "code", "state": nonce, "code_challenge": challenge, "code_challenge_method": "S256", "team": config.workspace_id}
    return Response({"url": "https://slack.com/oauth/v2_user/authorize?" + urlencode(query)})


def callback(request):
    # A one-use database state binds the callback to the initiating admin.
    nonce = request.GET.get("state", "")
    attempt = SlackOAuthAttempt.objects.select_related("user").filter(nonce=nonce, consumed=False, expires_at__gt=timezone.now()).first()
    outcome = "failed"
    if attempt and is_manager(attempt.user) and attempt.user.is_active and SlackOAuthAttempt.objects.filter(pk=attempt.pk, consumed=False).update(consumed=True):
        try:
            result = token_request({"code": request.GET.get("code", ""), "grant_type": "authorization_code", "redirect_uri": os.environ["SLACK_CONTEXT_REDIRECT_URI"], "code_verifier": decrypt_secret(attempt.encrypted_verifier)})
            config = SlackIntakeSettings.objects.get(pk=1)
            workspace = result.get("team", {}).get("id")
            user = result.get("authed_user", {}).get("id")
            scopes = result.get("scope") or result.get("authed_user", {}).get("scope", "")
            scopes = scopes.replace(" ", ",").split(",")
            if result.get("token_type") != "user" or workspace != config.workspace_id or user != config.clare_user_id or not set(SCOPES) <= set(scopes):
                raise McpError("Incorrect workspace, user, token type or missing read scopes.")
            revoke()
            seconds = result.get("expires_in")
            SlackContextGrant.objects.update_or_create(pk=1, defaults={"workspace_id": workspace, "slack_user_id": user,
                "encrypted_token": encrypt_secret(result["access_token"])[0], "encrypted_refresh": encrypt_secret(result["refresh_token"])[0] if result.get("refresh_token") else "",
                "expires_at": timezone.now() + timedelta(seconds=int(seconds)) if seconds else None, "scopes": scopes,
                "connected_by": attempt.user, "active": True, "revision": uuid.uuid4(), "capabilities": {}})
            outcome = "connected"
        except Exception:
            # No provider error, code or token is returned to the browser or logs.
            pass
        finally:
            SlackOAuthAttempt.objects.filter(pk=attempt.pk).update(encrypted_verifier="")
    return HttpResponseRedirect(settings.FRONTEND_URL.rstrip("/") + "/settings/slack?context=" + outcome)


def grant_token(grant):
    if grant.expires_at and grant.expires_at <= timezone.now() + timedelta(seconds=60):
        lease = uuid.uuid4()
        now = timezone.now()
        claimed = SlackContextGrant.objects.filter(pk=grant.pk, active=True, revision=grant.revision).filter(
            Q(refresh_lease_until__isnull=True) | Q(refresh_lease_until__lt=now)
        ).update(refresh_lease=lease, refresh_lease_until=now + timedelta(seconds=30))
        if not claimed:
            raise McpError("Slack authorization is refreshing or was disconnected. Retry context shortly.")
        try:
            current = SlackContextGrant.objects.get(pk=grant.pk)
            if current.expires_at and current.expires_at <= timezone.now() + timedelta(seconds=60):
                if not current.encrypted_refresh:
                    raise McpError("Slack user grant expired. Reconnect it.")
                # No database locks are held during the remote token exchange.
                result = token_request({"grant_type": "refresh_token", "refresh_token": decrypt_secret(current.encrypted_refresh)})
                changes = {"encrypted_token": encrypt_secret(result["access_token"])[0],
                           "expires_at": timezone.now() + timedelta(seconds=int(result.get("expires_in", 3600))), "updated_at": timezone.now()}
                if result.get("refresh_token"):
                    changes["encrypted_refresh"] = encrypt_secret(result["refresh_token"])[0]
                if not SlackContextGrant.objects.filter(pk=grant.pk, active=True, revision=grant.revision, refresh_lease=lease).update(**changes):
                    raise McpError("Slack authorization changed while refreshing.")
                current.refresh_from_db()
            return decrypt_secret(current.encrypted_token)
        finally:
            SlackContextGrant.objects.filter(pk=grant.pk, refresh_lease=lease).update(refresh_lease=None, refresh_lease_until=None)
    return decrypt_secret(grant.encrypted_token)


def read_thread_page(token, params, deadline):
    remaining = deadline - time.monotonic()
    if remaining < 1:
        raise McpError("Slack context time budget reached.")
    with requests.get("https://slack.com/api/conversations.replies", params=params,
                      headers={"Authorization": f"Bearer {token}"}, timeout=(min(3, remaining), min(5, remaining)),
                      allow_redirects=False, stream=True) as response:
        if response.status_code != 200:
            raise McpError("Slack thread is unavailable or rate limited.")
        body = bytearray()
        for chunk in response.iter_content(4096):
            body.extend(chunk)
            if len(body) > 512000 or time.monotonic() > deadline:
                raise McpError("Slack thread exceeded its size or time budget.")
        result = json.loads(body)
        if not isinstance(result, dict):
            raise McpError("Slack thread format changed.")
        return result


def retrieve(obj, deadline):
    config = SlackIntakeSettings.objects.filter(pk=1).first()
    grant = SlackContextGrant.objects.filter(pk=1, active=True).first()
    if not grant or not config or grant.workspace_id != config.workspace_id or grant.slack_user_id != config.clare_user_id:
        return [evidence("slack:remote", "slack", {"note": "Live Slack context is not connected. Captured portal messages are still available."}, completeness="unavailable")]
    channel = obj.channel.channel_id
    if not re.fullmatch(r"[CG][A-Z0-9]{2,31}", channel) or not obj.channel.context_enabled:
        return []
    out = []
    try:
        token = grant_token(grant)
        # Thread retrieval uses Slack's stable read API, with bounded pagination.
        # MCP adds historical search when its reviewed schema is available.
        cursor = ""
        count = 0
        for page in range(2):
            if time.monotonic() >= deadline - 15:
                raise McpError("Slack context time budget reached.")
            params = {"channel": channel, "ts": obj.source_key.rsplit(":", 1)[-1], "limit": 30}
            if cursor:
                params["cursor"] = cursor
            data = read_thread_page(token, params, min(deadline - 15, time.monotonic() + 8))
            if not data.get("ok"):
                if data.get("error") in ("token_revoked", "invalid_auth", "account_inactive"):
                    revoke()
                raise McpError("Slack thread access denied. Check user authorization and channel access.")
            messages = data.get("messages", [])
            if not isinstance(messages, list):
                raise McpError("Slack thread format changed.")
            for message in messages[:30]:
                if not isinstance(message, dict) or message.get("channel", channel) != channel:
                    continue
                if message.get("team", grant.workspace_id) != grant.workspace_id or message.get("thread_ts", params["ts"]) != params["ts"]:
                    continue
                ts = message.get("ts", "")
                if not re.fullmatch(r"[0-9]{10,16}\.[0-9]{6}", ts):
                    continue
                out.append(evidence(f"remote:{ts}", "slack", {"text": str(message.get("text", ""))[:6000], "message_ts": ts}, reference=f"{channel}/{ts}"))
                count += 1
            cursor = data.get("response_metadata", {}).get("next_cursor", "")
            if not cursor:
                break
        out.append(evidence("slack:thread-coverage", "slack", {"returned": count, "more_available": bool(cursor)}, completeness="partial" if cursor else "observed"))
        client = Client("slack", token, deadline=min(deadline - 10, time.monotonic() + 12))
        schemas = client.discover()
        # Never send user-provided query operators. Channel and dates are inserted
        # server-side; all returned messages are filtered again before storage.
        since = (timezone.now() - timedelta(days=30)).date().isoformat()
        query = f"in:{channel} after:{since}"
        result = client.read(SEARCH_TOOL, {"query": query}, allowed={SEARCH_TOOL: SEARCH_SCHEMA}, schemas=schemas)
        matches = result.get("messages", {}).get("matches", [])
        if not isinstance(matches, list):
            raise McpError("Slack search result format requires review.")
        for index, row in enumerate(matches[:20]):
            if not isinstance(row, dict) or row.get("channel", {}).get("id") != channel or row.get("team", grant.workspace_id) != grant.workspace_id:
                continue
            if not re.fullmatch(r"[0-9]{10,16}\.[0-9]{6}", str(row.get("ts", ""))) or not time.time() - 30 * 86400 <= float(row["ts"]) <= time.time():
                continue
            out.append(evidence(f"slack-search:{index}", "slack", {"text": str(row.get("text", ""))[:2500], "message_ts": str(row.get("ts", ""))[:32]}, reference=channel))
    except Exception as exc:
        message = str(exc) if isinstance(exc, McpError) else "Slack context could not be retrieved safely."
        out.append(evidence("slack:remote", "slack", {"error": message}, completeness="unavailable"))
    return list({item["key"]: item for item in out}.values())
