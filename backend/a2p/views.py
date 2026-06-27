import logging
import re
from datetime import date
from html import escape

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models import Q
from django.http import HttpResponse
from rest_framework import viewsets, status as http
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
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
    """Managers, or members explicitly granted the 'a2p' feature."""
    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        user = request.user
        return _is_manager(user) or (hasattr(user, "has_feature") and user.has_feature("a2p"))


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


def _a2p_pdf_html(s: A2PSubmission) -> str:
    """A clean, printable one-page record of a submission for the carrier handoff."""
    def e(v):
        return escape(str(v if v not in (None, "") else "—"))

    yn = {"yes": "Yes", "no": "No", "unsure": "Not sure"}
    msg = "; ".join(s.message_types or []) or "—"
    phones = "; ".join(
        f"{p.get('number', '')}" + (f" ({p.get('label')})" if p.get("label") else "")
        for p in (s.phone_numbers or [])
    ) or "—"

    def section(title, pairs):
        rows = "".join(f"<tr><th>{e(k)}</th><td>{e(v)}</td></tr>" for k, v in pairs)
        return f"<h2>{e(title)}</h2><table>{rows}</table>"

    body = (
        section("Business details", [
            ("Legal business name", s.legal_business_name), ("DBA / brand", s.dba_brand_name),
            ("EIN / Tax ID", s.ein_tax_id), ("Business type", s.business_type),
            ("Industry", s.business_industry), ("Website", s.business_website),
            ("Address", f"{s.business_address}, {s.city}, {s.state} {s.zip_code}"),
        ])
        + section("Contact & representative", [
            ("Business email", s.business_email), ("Business phone", s.business_phone),
            ("Representative", f"{s.rep_first_name} {s.rep_last_name} — {s.rep_job_title}"),
            ("Rep email", s.rep_email), ("Rep phone", s.rep_phone),
        ])
        + section("Brand & use case", [
            ("Use case", s.sms_use_case), ("Message types", msg),
            ("Program description", s.sms_program_description),
        ])
        + section("Opt-in & compliance", [
            ("Opt-in method", s.optin_method), ("Opt-in form URL", s.optin_form_url),
            ("SMS consent checkbox", yn.get(s.has_sms_consent_checkbox, s.has_sms_consent_checkbox)),
            ("Privacy policy", yn.get(s.has_privacy_policy, s.has_privacy_policy)),
            ("Privacy policy URL", s.privacy_policy_url),
            ("Terms of service", yn.get(s.has_terms_of_service, s.has_terms_of_service)),
            ("Terms of service URL", s.terms_of_service_url),
        ])
        + section("Phone numbers", [("Numbers", phones)])
        + (section("Notes", [("Additional notes", s.additional_notes)]) if s.additional_notes else "")
    )
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
      @page {{ size: A4; margin: 1.6cm; }}
      body {{ font-family: 'Liberation Sans', Arial, sans-serif; color:#0f172a; font-size:11px; }}
      h1 {{ font-size:18px; margin:0 0 2px; }}
      .meta {{ color:#64748b; font-size:10px; margin-bottom:14px; }}
      h2 {{ font-size:12px; margin:16px 0 4px; color:#db2777; border-bottom:1px solid #f1d6e6; padding-bottom:3px; }}
      table {{ width:100%; border-collapse:collapse; }}
      th {{ text-align:left; width:34%; vertical-align:top; color:#475569; font-weight:600; padding:3px 8px 3px 0; }}
      td {{ vertical-align:top; padding:3px 0; }}
    </style></head><body>
      <h1>A2P / 10DLC registration — {e(s.legal_business_name)}</h1>
      <div class="meta">Submission #{s.id} · Status: {e(s.get_status_display())} · {e(s.created_at)}</div>
      {body}
    </body></html>"""


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

    @action(detail=True, methods=["get"], url_path="export-pdf")
    def export_pdf(self, request, pk=None):
        """A clean one-page PDF of a single submission for the carrier handoff."""
        sub = self.get_object()
        try:
            from weasyprint import HTML
        except Exception:  # noqa: BLE001 — native libs not present
            return Response(
                {"error": "PDF generation is unavailable on this server."},
                status=http.HTTP_503_SERVICE_UNAVAILABLE,
            )
        try:
            pdf = HTML(string=_a2p_pdf_html(sub)).write_pdf()
        except Exception:  # noqa: BLE001
            logger.exception("A2P PDF render failed for submission %s", sub.id)
            return Response({"error": "Could not render the PDF."}, status=http.HTTP_502_BAD_GATEWAY)
        slug = re.sub(r"[^a-z0-9]+", "-", (sub.legal_business_name or "submission").lower()).strip("-") or "submission"
        resp = HttpResponse(pdf, content_type="application/pdf")
        resp["Content-Disposition"] = f'attachment; filename="a2p-{sub.id}-{slug}.pdf"'
        return resp
