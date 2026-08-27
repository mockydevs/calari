import json
import re
import uuid
from django.db import transaction
from django.db.models import F
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from common.permissions import IsManager
from builds.permissions import is_manager
from projects.models import Clients, GhlConnection
from projects import ghl_context
from .models import ClientInvestigation, InvestigationPolicy, StaffBrief
from . import investigations


class ContextThrottle(UserRateThrottle):
    scope = "client_context"
    rate = "6/min"


def private_access(user, task):
    if not is_manager(user) and task.assignee_id != user.pk:
        raise PermissionDenied("Client context is restricted to the assigned staff member and administrators.")


def current_context(obj):
    return obj.expires_at and obj.expires_at > timezone.now() and obj.status in ("ready", "partial") and investigations.fingerprint(obj) == obj.source_fingerprint and json.dumps(investigations.scope_for(obj), sort_keys=True) == json.dumps(obj.scope, sort_keys=True)


class RequestSerializer(serializers.Serializer):
    record_reference = serializers.RegexField(r"^[A-Za-z0-9_-]{1,120}$", required=False, allow_blank=True)


class DraftSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=0)
    revision = serializers.UUIDField()
    text = serializers.CharField(max_length=6000, allow_blank=True, trim_whitespace=False)
    ready = serializers.BooleanField(default=False)


def task_context(request, task):
    private_access(request.user, task)
    if request.method == "POST":
        throttle = ContextThrottle()
        if not throttle.allow_request(request, None):
            return Response({"error": "Please wait before requesting another investigation."}, status=429)
        serializer = RequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        obj = investigations.queue(task, force=True, record_reference=serializer.validated_data.get("record_reference"))
        if not obj:
            raise ValidationError("Link this task to a client build or mapped Slack request first.")
    brief = StaffBrief.objects.select_related("investigation").filter(task=task).first()
    if not brief:
        return Response({"status": "not_requested", "reason": "Request client context to gather available evidence.", "evidence": [], "brief": None})
    obj = brief.investigation
    visible = current_context(obj)
    return Response({"id": obj.pk, "revision": str(obj.revision), "status": obj.status if visible or obj.status not in ("ready", "partial") else "stale",
        "reason": obj.reason if visible or obj.status not in ("ready", "partial") else "Authorization or source context changed. Refresh to retrieve current evidence.",
        "completed_at": obj.completed_at, "expires_at": obj.expires_at,
        "evidence": list(obj.evidence.order_by("id").values("key", "source", "reference", "observation", "completeness", "retrieved_at", "sensitivity")) if visible else [],
        "brief": brief.content if visible and brief.generated_revision == obj.revision else None,
        "draft": {"text": brief.draft_text, "version": brief.draft_version, "ready": brief.draft_ready, "stale": brief.draft_stale, "edited": brief.draft_edited} if visible else None})


def save_draft(request, task):
    private_access(request.user, task)
    serializer = DraftSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    with transaction.atomic():
        brief = get_object_or_404(StaffBrief.objects.select_for_update().select_related("investigation"), task=task)
        obj = brief.investigation
        if not current_context(obj) or obj.revision != data["revision"] or brief.draft_version != data["version"]:
            return Response({"error": "Context or draft changed. Reload before saving; your text has not been overwritten."}, status=409)
        if data["ready"]:
            if not data["text"].strip():
                raise ValidationError("Write a reply before marking it ready.")
            if re.search(r"\b(sk-proj-|xox[bp]-|Bearer\s|api[_ -]?key|password|internal staff|portal team)\b", data["text"], re.I):
                raise ValidationError("Remove credentials or private staffing details before marking this reply ready.")
        brief.draft_text = data["text"]
        brief.draft_ready = data["ready"]
        brief.draft_edited = True
        brief.draft_stale = False
        brief.draft_version = F("draft_version") + 1
        brief.edited_by = request.user
        brief.save()
    return Response({"saved": True, "note": "Saved inside the portal only. Nothing sent to Slack."})


class PolicySerializer(serializers.Serializer):
    enabled = serializers.BooleanField(required=False)
    allow_record_reads = serializers.BooleanField(required=False)
    retention_days = serializers.IntegerField(min_value=1, max_value=90, required=False)


@api_view(["GET", "PATCH", "POST"])
@permission_classes([IsManager])
def policy_view(request, client_id):
    get_object_or_404(Clients, pk=client_id)
    policy, _ = InvestigationPolicy.objects.get_or_create(client_id=client_id)
    if request.method == "PATCH":
        serializer = PolicySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            policy = InvestigationPolicy.objects.select_for_update().get(pk=policy.pk)
            for key, value in serializer.validated_data.items():
                setattr(policy, key, value)
            policy.revision = uuid.uuid4()
            policy.save()
            investigations.invalidate(ClientInvestigation.objects.filter(client_id=client_id), "Client context permissions or retention changed. Refresh under the new policy.")
    capabilities = None
    if request.method == "POST":
        throttle = ContextThrottle()
        if not throttle.allow_request(request, None):
            return Response({"error": "Please wait before checking capabilities again."}, status=429)
        connection = get_object_or_404(GhlConnection, client_id=client_id)
        try:
            capabilities = ghl_context.capabilities(connection)
        except Exception:
            return Response({"error": "Could not inspect MCP capabilities. Check the token and scopes."}, status=502)
    return Response({"enabled": policy.enabled, "allow_record_reads": policy.allow_record_reads, "retention_days": policy.retention_days,
        "capabilities": capabilities, "limits": "8 GHL data reads; 45-second investigation budget; 5-minute configuration cache; one investigation at a time per client."})
