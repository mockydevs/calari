import logging
from datetime import date

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models import Q
from rest_framework import viewsets
from rest_framework.permissions import AllowAny, IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter

from projects.tasks import send_notification_email
from .models import A2PSubmission
from .serializers import A2PSubmissionSerializer, A2PSubmissionCreateSerializer

logger = logging.getLogger(__name__)
User = get_user_model()


def _is_manager(user):
    return bool(
        user and user.is_authenticated
        and (user.is_superuser or getattr(user, "role", None) in ("superuser", "admin"))
    )


class IsManager(IsAuthenticated):
    def has_permission(self, request, view):
        return super().has_permission(request, view) and _is_manager(request.user)


def _notify_team(sub: A2PSubmission):
    """Email the team a clean summary of a new A2P intake (reuses Calari's mailer)."""
    recipients = [e.strip() for e in (getattr(settings, "A2P_NOTIFY_EMAILS", "") or "").split(",") if e.strip()]
    if not recipients:
        recipients = list(
            User.objects.filter(is_active=True)
            .filter(Q(is_superuser=True) | Q(role__in=["admin", "superuser"]))
            .exclude(email="").values_list("email", flat=True)
        )
    if not recipients:
        return
    frontend = getattr(settings, "FRONTEND_URL", "http://localhost:3000").rstrip("/")
    numbers = ", ".join(p.get("number", "") for p in (sub.phone_numbers or []) if p.get("number")) or "—"
    detail = (
        f"{sub.legal_business_name} — {sub.sms_use_case}. "
        f"Rep: {sub.rep_first_name} {sub.rep_last_name} ({sub.rep_email}). Numbers: {numbers}."
    )
    for r in recipients:
        try:
            send_notification_email.delay(
                recipient_email=r,
                subject=f"New A2P intake: {sub.legal_business_name}",
                context={
                    "recipient_name": "Team",
                    "event_type": "comment_added",
                    "event_title": f"New A2P/10DLC intake — {sub.legal_business_name}",
                    "event_detail": detail,
                    "actor_name": f"{sub.rep_first_name} {sub.rep_last_name}".strip() or "Website",
                    "project_name": "A2P registration",
                    "portal_url": f"{frontend}/a2p/{sub.id}",
                    "year": date.today().year,
                },
            )
        except Exception:  # noqa: BLE001 — broker/SMTP must never fail the submission
            logger.exception("A2P team notification failed for %s", r)


class A2PSubmissionViewSet(viewsets.ModelViewSet):
    """Public create (intake form); manager-only list/detail/update/delete (review)."""
    queryset = A2PSubmission.objects.all()
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["status"]
    search_fields = ["legal_business_name", "dba_brand_name", "business_email", "rep_email"]
    ordering_fields = ["created_at", "status"]
    ordering = ["-created_at"]

    def get_permissions(self):
        if self.action == "create":
            return [AllowAny()]
        return [IsManager()]

    def get_serializer_class(self):
        return A2PSubmissionCreateSerializer if self.action == "create" else A2PSubmissionSerializer

    def perform_create(self, serializer):
        sub = serializer.save()
        _notify_team(sub)
