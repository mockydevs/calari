import hashlib
import hmac
import os

from django.conf import settings as dj_settings
from django.contrib.auth import get_user_model
from django.shortcuts import redirect
from rest_framework import viewsets, status as http
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.permissions import IsAuthenticated, AllowAny, BasePermission
from rest_framework.response import Response
from rest_framework.filters import OrderingFilter, SearchFilter
from django_filters.rest_framework import DjangoFilterBackend

from . import services, oauth
from .models import (
    Connection, IntegrationMap, CallInsight, IntegrationEvent, AutomationSettings,
)

User = get_user_model()
from .serializers import (
    ConnectionSerializer, IntegrationMapSerializer,
    CallInsightSerializer, IntegrationEventSerializer, AutomationSettingsSerializer,
)


def _is_manager(user) -> bool:
    return bool(user and user.is_authenticated and (
        user.is_superuser or getattr(user, "role", None) in ("superuser", "admin")
    ))


class IsManager(BasePermission):
    """Onboarding config + credentials are admin/manager territory (secrets)."""
    def has_permission(self, request, view):
        return _is_manager(request.user)


def _enqueue(task_fn, *args):
    """Queue a Celery task; swallow broker-down so the webhook still 200s."""
    try:
        task_fn.delay(*args)
        return True
    except Exception:  # noqa: BLE001
        return False


class ConnectionViewSet(viewsets.ModelViewSet):
    queryset = Connection.objects.all()
    serializer_class = ConnectionSerializer
    permission_classes = [IsManager]
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ["provider", "active"]
    ordering = ["provider", "-updated_at"]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=["post"])
    def test(self, request, pk=None):
        """Validate this connection's token with a lightweight authenticated ping."""
        from . import integrations
        conn = self.get_object()
        try:
            token = services.decrypt_secret(conn.encrypted_secret)
        except Exception:  # noqa: BLE001
            return Response({"ok": False, "detail": "Stored token could not be decrypted."})
        ok, detail = integrations.test_connection(conn.provider, token)
        return Response({"ok": ok, "detail": detail})


class IntegrationMapViewSet(viewsets.ModelViewSet):
    queryset = IntegrationMap.objects.select_related("client").all()
    serializer_class = IntegrationMapSerializer
    permission_classes = [IsManager]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["client", "active"]
    search_fields = ["client__name", "client_number"]
    ordering = ["client_number", "client_id"]


class CallInsightViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = CallInsight.objects.select_related("client").prefetch_related("events").all()
    serializer_class = CallInsightSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["client", "status"]
    search_fields = ["title", "summary"]
    ordering = ["-created_at"]


class IntegrationEventViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = IntegrationEvent.objects.select_related("call_insight").all()
    serializer_class = IntegrationEventSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ["call_insight", "target", "status"]
    ordering = ["-created_at"]

    @action(detail=True, methods=["post"], permission_classes=[IsManager])
    def retract(self, request, pk=None):
        """Undo a posted action (delete the Slack message / Asana task)."""
        from .tasks import retract_event
        ev = self.get_object()
        _enqueue(retract_event, ev.id)
        return Response({"status": "retracting"}, status=http.HTTP_202_ACCEPTED)


# ─── Automation settings (singleton) ──────────────────────────────────────────
@api_view(["GET", "PATCH"])
@permission_classes([IsManager])
def automation_settings(request):
    obj = AutomationSettings.load()
    if request.method == "PATCH":
        ser = AutomationSettingsSerializer(obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)
    return Response(AutomationSettingsSerializer(obj).data)


# ─── Predictive upsell (Phase 5) ──────────────────────────────────────────────
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def client_upsell(request, client_id):
    """Suggest next services for a client from their accumulated call insights."""
    insights = list(
        CallInsight.objects.filter(client_id=client_id)
        .exclude(insight__isnull=True).order_by("-created_at")[:20]
    )
    if not insights:
        return Response({"suggestions": [], "detail": "No call insights for this client yet."})
    client_name = insights[0].client.name if insights[0].client_id else ""
    blocks = []
    for ci in insights:
        ins = ci.insight or {}
        blocks.append(
            f"[{ci.call_date or ci.created_at:%Y-%m-%d}] {ci.title}\n"
            f"Summary: {ci.summary}\n"
            f"Needs: {'; '.join(ins.get('needs', []))}\n"
            f"Services mentioned: {'; '.join(ins.get('services_mentioned', []))}\n"
            f"Upsell signals: {'; '.join(ins.get('upsell_signals', []))}"
        )
    result = services.suggest_upsell(client_name, "\n\n".join(blocks))
    return Response(result)


# ─── OAuth connect flows (Slack / Asana / Google) ──────────────────────────────
def _oauth_redirect_uri(provider, request):
    base = getattr(dj_settings, "ONBOARDING_OAUTH_REDIRECT_BASE", "") or request.build_absolute_uri("/").rstrip("/")
    return f"{base}/api/onboarding/oauth/{provider}/callback/"


@api_view(["POST"])
@permission_classes([IsManager])
def oauth_authorize_url(request, provider):
    """Return the provider authorize URL (with a signed state) for the browser to visit."""
    provider = provider.upper()
    if not oauth.is_supported(provider):
        return Response({"error": f"{provider} does not support OAuth here."}, status=http.HTTP_400_BAD_REQUEST)
    if not oauth.is_configured(provider):
        return Response({"error": f"{provider} OAuth is not configured on the server (client id/secret)."},
                        status=http.HTTP_400_BAD_REQUEST)
    state = oauth.sign_state(provider, request.user.id)
    url = oauth.authorize_url(provider, state, _oauth_redirect_uri(provider, request))
    return Response({"url": url})


@api_view(["GET"])
@permission_classes([AllowAny])
def oauth_callback(request, provider):
    """Public OAuth redirect target. Verifies signed state, exchanges code, saves the
    connection, and bounces back to the frontend Integrations page."""
    provider = provider.upper()
    frontend = getattr(dj_settings, "FRONTEND_URL", "http://localhost:3000").rstrip("/")
    dest = f"{frontend}/settings/connections"

    if request.query_params.get("error"):
        return redirect(f"{dest}?error={request.query_params.get('error')}")
    code = request.query_params.get("code")
    state = request.query_params.get("state", "")
    if not code or not state:
        return redirect(f"{dest}?error=missing_code")
    try:
        state_provider, user_id = oauth.unsign_state(state)
        if state_provider != provider:
            raise oauth.OAuthError("state/provider mismatch")
        token = oauth.exchange_code(provider, code, _oauth_redirect_uri(provider, request))
        user = User.objects.filter(pk=user_id).first()
        services.save_oauth_connection(provider, token, user)
    except Exception as e:  # noqa: BLE001
        return redirect(f"{dest}?error={str(e)[:120]}")
    return redirect(f"{dest}?connected={provider}")


# ─── Fireflies webhook ─────────────────────────────────────────────────────────
@api_view(["POST"])
@permission_classes([AllowAny])
def fireflies_webhook(request):
    """Fireflies fires here when a transcription is ready. Verify signature, extract the
    call id, enqueue ingestion, and 200 fast. Idempotency is handled in the task."""
    secret = os.getenv("FIREFLIES_WEBHOOK_SECRET", "")
    if secret:
        provided = request.headers.get("X-Hub-Signature-256") or request.headers.get("x-fireflies-signature") or ""
        provided = provided.split("=")[-1].strip()
        digest = hmac.new(secret.encode(), request.body, hashlib.sha256).hexdigest()
        if not provided or not hmac.compare_digest(provided, digest):
            return Response({"error": "invalid signature"}, status=http.HTTP_401_UNAUTHORIZED)

    data = request.data if isinstance(request.data, dict) else {}
    call_id = data.get("meetingId") or data.get("transcriptId") or data.get("id")
    if not call_id:
        return Response({"error": "no meeting id in payload"}, status=http.HTTP_400_BAD_REQUEST)
    from .tasks import ingest_fireflies_call
    _enqueue(ingest_fireflies_call, str(call_id), data)
    return Response({"status": "accepted"}, status=http.HTTP_202_ACCEPTED)
