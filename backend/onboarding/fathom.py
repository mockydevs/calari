"""Signed Fathom imports. No outbound network/AI work on webhook delivery."""
import base64
import binascii
import hashlib
import hmac
import json
import time
from urllib.parse import urlparse

from django.core.exceptions import RequestDataTooBig
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError

from builds.models import Activity, Build, MeetingNote
from common.permissions import IsManager
from .models import FathomMeeting, FathomRoutingRule, FathomSettings
from .services import decrypt_secret, encrypt_secret

MAX_WEBHOOK_BYTES = 2 * 1024 * 1024


def secret_bytes(secret):
    if not secret.startswith("whsec_"):
        raise ValueError("Expected a Fathom webhook signing secret starting with whsec_.")
    try:
        decoded = base64.b64decode(secret[6:], validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("Invalid webhook signing secret.") from exc
    if len(decoded) < 16:
        raise ValueError("Invalid webhook signing secret.")
    return decoded


def verify_signature(secret, headers, body):
    message_id = headers.get("webhook-id", "")
    timestamp = headers.get("webhook-timestamp", "")
    signatures = headers.get("webhook-signature", "")
    if not message_id or len(message_id) > 255 or len(signatures) > 4096:
        return False
    try:
        if abs(time.time() - int(timestamp)) > 300:
            return False
        content = f"{message_id}.{timestamp}.".encode() + body
        expected = base64.b64encode(hmac.digest(secret_bytes(secret), content, hashlib.sha256)).decode()
        return any(
            hmac.compare_digest(signature[3:], expected)
            for signature in signatures.split() if signature.startswith("v1,")
        )
    except (ValueError, TypeError, UnicodeError):
        return False


class SpeakerSerializer(serializers.Serializer):
    display_name = serializers.CharField(required=False, allow_blank=True, max_length=1000)


class TranscriptLineSerializer(serializers.Serializer):
    speaker = SpeakerSerializer(required=False, allow_null=True)
    text = serializers.CharField(max_length=500_000, allow_blank=True)
    timestamp = serializers.CharField(required=False, allow_blank=True, max_length=32)


class SummarySerializer(serializers.Serializer):
    markdown_formatted = serializers.CharField(required=False, allow_blank=True, max_length=1_000_000)


class InviteeSerializer(serializers.Serializer):
    email = serializers.EmailField(required=False, allow_null=True, allow_blank=True)


class ActionItemSerializer(serializers.Serializer):
    description = serializers.CharField(max_length=100_000, allow_blank=True)


class WebhookPayloadSerializer(serializers.Serializer):
    recording_id = serializers.IntegerField(min_value=1, max_value=2**63 - 1)
    title = serializers.CharField(max_length=1000)
    share_url = serializers.URLField(required=False, allow_blank=True, max_length=1000)
    recording_start_time = serializers.DateTimeField(required=False, allow_null=True)
    calendar_invitees = InviteeSerializer(many=True, required=False)
    default_summary = SummarySerializer(required=False, allow_null=True)
    transcript = TranscriptLineSerializer(many=True, required=False, allow_null=True)
    action_items = ActionItemSerializer(many=True, required=False, allow_null=True)

    def validate_share_url(self, value):
        # These are displayed as links, never fetched. Do not accept arbitrary
        # external URLs from a provider payload as trusted recording links.
        parsed = urlparse(value)
        if value and (parsed.scheme != "https" or parsed.hostname not in {"fathom.video", "www.fathom.video"}):
            raise serializers.ValidationError("Expected an HTTPS Fathom recording link.")
        return value

    def validate(self, data):
        if not ((data.get("default_summary") or {}).get("markdown_formatted") or data.get("transcript") or data.get("action_items")):
            raise serializers.ValidationError("Include the transcript, summary, or action items in the Fathom webhook.")
        return data


def meeting_defaults(data, message_id):
    transcript = "\n".join(
        f"[{line.get('timestamp', '')}] {(line.get('speaker') or {}).get('display_name', 'Speaker')}: {line['text']}"
        for line in data.get("transcript") or []
    )
    return {
        "webhook_id": message_id,
        "title": data["title"][:255],
        "recording_url": data.get("share_url", ""),
        "occurred_at": data.get("recording_start_time"),
        "participant_emails": sorted({p["email"].strip().lower() for p in data.get("calendar_invitees", []) if p.get("email")}),
        "summary": (data.get("default_summary") or {}).get("markdown_formatted", ""),
        "transcript": transcript,
        "action_items": [item["description"] for item in data.get("action_items") or [] if item["description"]],
    }


def attach_meeting(meeting, build, actor="Fathom"):
    """Caller holds the meeting row lock (or has just created it) in a transaction."""
    if meeting.status != FathomMeeting.Status.PENDING:
        raise ValidationError("This meeting has already been handled.")
    parts = [f"Fathom meeting: {meeting.title}"]
    if meeting.recording_url:
        parts.append(f"Recording: {meeting.recording_url}")
    if meeting.summary:
        parts.append(f"Fathom summary (AI-generated):\n{meeting.summary}")
    if meeting.action_items:
        parts.append("Fathom suggested action items (review before assignment):\n" + "\n".join(f"- {item}" for item in meeting.action_items))
    if meeting.transcript:
        parts.append(f"Meeting transcript:\n{meeting.transcript}")
    meeting.note = MeetingNote.objects.create(
        build=build, source="fathom", kind="meeting", title=meeting.title,
        meeting_date=meeting.occurred_at.date() if meeting.occurred_at else None,
        raw_text="\n\n".join(parts),
    )
    meeting.status = FathomMeeting.Status.ATTACHED
    meeting.routing_reason = ""
    meeting.save(update_fields=["note", "status", "routing_reason"])
    Activity.objects.create(build=build, actor=actor, message=f"Fathom meeting imported: {meeting.title}")


@csrf_exempt
@require_POST
def webhook(request):
    config = FathomSettings.objects.filter(pk=1, enabled=True).first()
    if not config or not config.encrypted_webhook_secret:
        return JsonResponse({"error": "Fathom import is not enabled."}, status=503)
    try:
        if int(request.headers.get("content-length", "0")) > MAX_WEBHOOK_BYTES:
            return JsonResponse({"error": "Payload too large."}, status=413)
        body = request.body
    except RequestDataTooBig:
        return JsonResponse({"error": "Payload too large."}, status=413)
    except ValueError:
        return JsonResponse({"error": "Invalid content length."}, status=400)
    if len(body) > MAX_WEBHOOK_BYTES:
        return JsonResponse({"error": "Payload too large."}, status=413)
    try:
        secret = decrypt_secret(config.encrypted_webhook_secret)
    except Exception:  # Stored configuration failure: never leak crypto details.
        return JsonResponse({"error": "Fathom signing configuration is unavailable."}, status=503)
    if not verify_signature(secret, request.headers, body):
        return JsonResponse({"error": "Invalid webhook signature."}, status=401)
    try:
        payload = json.loads(body)
    except (ValueError, UnicodeError):
        return JsonResponse({"error": "Invalid JSON."}, status=400)
    serializer = WebhookPayloadSerializer(data=payload)
    if not serializer.is_valid():
        return JsonResponse({"error": "Invalid meeting payload. Include meeting content and a recording ID."}, status=400)
    data = serializer.validated_data
    # Durable, atomic ingestion; a failed write is not acknowledged. Fathom can
    # retry. Recording uniqueness also handles resend with a new message ID.
    with transaction.atomic():
        meeting, created = FathomMeeting.objects.get_or_create(
            recording_id=str(data["recording_id"]), defaults=meeting_defaults(data, request.headers["webhook-id"]),
        )
        if created:
            targets = list(FathomRoutingRule.objects.filter(
                active=True, participant_email__in=meeting.participant_emails,
            ).order_by().values_list("build_id", flat=True).distinct()[:2])
            if len(targets) == 1:
                build = Build.objects.filter(pk=targets[0]).first()
                if build:
                    attach_meeting(meeting, build)
            if meeting.status == FathomMeeting.Status.PENDING:
                meeting.routing_reason = "Multiple routing rules matched different builds." if len(targets) > 1 else "No active routing rule matched."
                meeting.save(update_fields=["routing_reason"])
    return JsonResponse({"ok": True, "duplicate": not created})


class SettingsInputSerializer(serializers.Serializer):
    enabled = serializers.BooleanField(required=False)
    webhook_secret = serializers.CharField(required=False, write_only=True, max_length=512, trim_whitespace=True)

    def validate_webhook_secret(self, value):
        try:
            secret_bytes(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from exc
        return value


@api_view(["GET", "PATCH"])
@permission_classes([IsManager])
def settings_view(request):
    config = FathomSettings.objects.filter(pk=1).first()
    if request.method == "PATCH":
        serializer = SettingsInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            FathomSettings.objects.get_or_create(pk=1)
            config = FathomSettings.objects.select_for_update().get(pk=1)
            if data.get("webhook_secret"):
                config.encrypted_webhook_secret = encrypt_secret(data["webhook_secret"])[0]
            config.enabled = data.get("enabled", config.enabled)
            if config.enabled and not config.encrypted_webhook_secret:
                raise ValidationError("Save a webhook signing secret before enabling imports.")
            config.save()
    return Response({
        "enabled": bool(config and config.enabled),
        "secret_configured": bool(config and config.encrypted_webhook_secret),
        "webhook_path": "/api/webhooks/fathom",
        "pending_count": FathomMeeting.objects.filter(status=FathomMeeting.Status.PENDING).count(),
    })


class RuleSerializer(serializers.ModelSerializer):
    build_title = serializers.CharField(source="build.title", read_only=True)
    client_name = serializers.CharField(source="build.client.name", read_only=True)

    class Meta:
        model = FathomRoutingRule
        fields = ["id", "participant_email", "build", "build_title", "client_name", "active"]

    def validate_participant_email(self, value):
        value = value.strip().lower()
        existing = FathomRoutingRule.objects.filter(participant_email__iexact=value)
        if self.instance:
            existing = existing.exclude(pk=self.instance.pk)
        if existing.exists():
            raise serializers.ValidationError("This email already has a routing rule.")
        return value


class RuleViewSet(viewsets.ModelViewSet):
    permission_classes = [IsManager]
    serializer_class = RuleSerializer
    pagination_class = None
    queryset = FathomRoutingRule.objects.select_related("build__client").only(
        "id", "participant_email", "active", "build_id", "build__id", "build__title",
        "build__client_id", "build__client__id", "build__client__name",
    )
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]


class MeetingSerializer(serializers.ModelSerializer):
    build = serializers.IntegerField(source="note.build_id", read_only=True, default=None)
    build_title = serializers.CharField(source="note.build.title", read_only=True, default=None)

    class Meta:
        model = FathomMeeting
        fields = ["id", "recording_id", "title", "recording_url", "occurred_at", "participant_emails", "status", "routing_reason", "note", "build", "build_title", "received_at"]
        read_only_fields = fields


class MeetingDetailSerializer(MeetingSerializer):
    class Meta(MeetingSerializer.Meta):
        fields = MeetingSerializer.Meta.fields + ["summary", "transcript", "action_items"]
        read_only_fields = fields


class InboxPagination(PageNumberPagination):
    page_size = 20


class AttachSerializer(serializers.Serializer):
    build = serializers.PrimaryKeyRelatedField(queryset=Build.objects.all())


class MeetingViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsManager]
    pagination_class = InboxPagination
    queryset = FathomMeeting.objects.select_related("note__build").all()

    def get_serializer_class(self):
        return MeetingDetailSerializer if self.action == "retrieve" else MeetingSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "list":
            status = self.request.query_params.get("status", "pending")
            if status not in FathomMeeting.Status.values:
                raise ValidationError("Invalid meeting status.")
            qs = qs.filter(status=status).only(
                "id", "recording_id", "title", "recording_url", "occurred_at", "participant_emails",
                "status", "routing_reason", "note_id", "received_at", "note__id", "note__build_id",
                "note__build__id", "note__build__title",
            )
        return qs

    @action(detail=True, methods=["post"])
    def attach(self, request, pk=None):
        serializer = AttachSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            # Lock only the meeting, not nullable joined note/build relations.
            meeting = FathomMeeting.objects.select_for_update().get(pk=self.get_object().pk)
            if meeting.status == FathomMeeting.Status.ATTACHED and meeting.note_id and meeting.note.build_id == serializer.validated_data["build"].id:
                return Response(MeetingSerializer(meeting).data)
            attach_meeting(meeting, serializer.validated_data["build"], actor=request.user.get_full_name() or request.user.username)
        return Response(MeetingSerializer(meeting).data)

    @action(detail=True, methods=["post"])
    def ignore(self, request, pk=None):
        with transaction.atomic():
            meeting = FathomMeeting.objects.select_for_update().get(pk=self.get_object().pk)
            if meeting.status == FathomMeeting.Status.ATTACHED:
                raise ValidationError("An attached meeting cannot be ignored.")
            meeting.status = FathomMeeting.Status.IGNORED
            meeting.save(update_fields=["status"])
        return Response(MeetingSerializer(meeting).data)
