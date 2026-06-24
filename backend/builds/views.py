import secrets
from datetime import date

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone

from projects.tasks import send_notification_email
from rest_framework import viewsets, status as http
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter

from .models import (
    Build, ContactSource, PipelineStage, ManualAction, Task, TaskDependency,
    Document, MeetingNote, Comment, Activity, ChangeRequest, ApprovalRecord,
    BuildMemorySnapshot, ClientPortalFeedback, Notification, NotificationPreference,
    AiApiKey, TeamInvite, BuildStatus,
)
from .serializers import (
    BuildSerializer, BuildListSerializer, ContactSourceSerializer, PipelineStageSerializer,
    ManualActionSerializer, TaskSerializer, TaskCardSerializer, TaskDependencySerializer,
    DocumentSerializer, MeetingNoteSerializer, CommentSerializer, ActivitySerializer,
    ChangeRequestSerializer, ApprovalRecordSerializer, BuildMemorySnapshotSerializer,
    ClientPortalFeedbackSerializer, NotificationSerializer, NotificationPreferenceSerializer,
    AiApiKeySerializer, TeamInviteSerializer,
)
from . import services

User = get_user_model()
PERMS = [IsAuthenticated]


# ─── helpers ──────────────────────────────────────────────────────────────────
def _is_manager(user):
    return bool(user and (user.is_superuser or getattr(user, "role", None) in ("superuser", "admin")))


def _log(build, user, message):
    Activity.objects.create(
        build=build,
        actor=(user.get_full_name() or user.username) if user else "system",
        message=message,
    )


_PREF_MAP = {
    "BUILD_ASSIGNED": "build_assigned",
    "TASK_ASSIGNED": "build_assigned",
    "TASK_UPDATED": "task_updated",
    "MEETING_NOTE_ADDED": "follow_up_notes",
    "CHANGE_REQUEST": "change_requests",
    "READY_FOR_REVIEW": "ready_for_review",
    "CHANGES_REQUESTED": "ready_for_review",
    "DOCUMENT_UPLOADED": "document_uploaded",
}
# Map builds notification types onto the email template's event_type styles.
_EMAIL_EVENT_MAP = {
    "BUILD_ASSIGNED": "project_assigned",
    "TASK_ASSIGNED": "project_assigned",
    "TASK_UPDATED": "task_status_changed",
    "READY_FOR_REVIEW": "project_status_changed",
    "CHANGES_REQUESTED": "project_status_changed",
    "CHANGE_REQUEST": "blocker_added",
    "NEW_COMMENT": "comment_added",
    "DOCUMENT_UPLOADED": "comment_added",
}


def _notify(user, type_, message, link, actor=None, build_name=""):
    """Create an in-app notification AND send a templated email, honoring prefs."""
    if not user:
        return
    pref = getattr(user, "notification_preference", None)
    if pref and not getattr(pref, _PREF_MAP.get(type_, ""), True):
        return
    Notification.objects.create(user=user, type=type_, message=message, link=link)

    if not getattr(user, "email", None):
        return
    frontend = getattr(settings, "FRONTEND_URL", "http://localhost:3000").rstrip("/")
    try:
        send_notification_email.delay(
            recipient_email=user.email,
            subject=message,
            context={
                "recipient_name": user.get_full_name() or user.username,
                "event_type": _EMAIL_EVENT_MAP.get(type_, ""),
                "event_title": message,
                "event_detail": "",
                "actor_name": (actor.get_full_name() or actor.username) if actor else "Calari Staff Portal",
                "project_name": build_name,
                "portal_url": f"{frontend}{link}",
                "year": date.today().year,
            },
        )
    except Exception:
        pass  # never let email failures break the request


def _501(exc):
    return Response({"error": str(exc)}, status=http.HTTP_501_NOT_IMPLEMENTED)


# ─── Builds ───────────────────────────────────────────────────────────────────
# Relations the detail page renders — each is a separate round-trip to the DB,
# so we only load them for `retrieve` (and the generate-brief response), never
# for list/mutating actions which otherwise paid the full prefetch cost.
_DETAIL_PREFETCH = (
    "contact_sources", "stages__manual_actions", "tasks__assignee",
    "documents__uploader", "comments__author",
    "change_requests__owner", "change_requests__created_by",
    "approvals__approver", "memory_snapshots__created_by", "activities",
)


class BuildViewSet(viewsets.ModelViewSet):
    queryset = Build.objects.select_related("client", "creator", "assignee").all()
    permission_classes = PERMS
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["status", "assignee", "client"]
    search_fields = ["title", "goals", "integrations", "client__name"]
    ordering_fields = ["created_at", "updated_at", "due_date"]
    ordering = ["-created_at"]

    def _detail_queryset(self):
        return Build.objects.select_related("client", "creator", "assignee").prefetch_related(*_DETAIL_PREFETCH)

    def get_queryset(self):
        # Only the detail view needs the full relation graph; everything else
        # (list, assign, status, enable-portal, destroy, …) stays lean.
        if self.action == "retrieve":
            return self._detail_queryset()
        return Build.objects.select_related("client", "creator", "assignee").all()

    def get_serializer_class(self):
        return BuildListSerializer if self.action == "list" else BuildSerializer

    def perform_create(self, serializer):
        build = serializer.save(creator=self.request.user)
        _log(build, self.request.user, f'Build "{build.title}" created.')

    @action(detail=True, methods=["post"])
    def assign(self, request, pk=None):
        build = self.get_object()
        assignee = User.objects.filter(id=request.data.get("assignee_id")).first()
        if not assignee:
            return Response({"error": "assignee_id required / not found"}, status=http.HTTP_400_BAD_REQUEST)
        build.assignee = assignee
        if build.status in (BuildStatus.DRAFT, BuildStatus.AI_DRAFTED):
            build.status = BuildStatus.ASSIGNED
        build.save()
        _log(build, request.user, f"Assigned to {assignee.get_full_name() or assignee.username}.")
        _notify(assignee, "BUILD_ASSIGNED", f'You were assigned to "{build.title}".', f"/builds/{build.id}")
        return Response(BuildSerializer(build).data)

    @action(detail=True, methods=["post"], url_path="status")
    def set_status(self, request, pk=None):
        build = self.get_object()
        new_status = request.data.get("status")
        if new_status not in BuildStatus.values:
            return Response({"error": "invalid status"}, status=http.HTTP_400_BAD_REQUEST)
        build.status = new_status
        build.save(update_fields=["status", "updated_at"])
        _log(build, request.user, f"Status → {new_status}.")
        if new_status == BuildStatus.READY_FOR_REVIEW:
            _notify(build.creator, "READY_FOR_REVIEW", f'"{build.title}" is ready for review.', f"/builds/{build.id}")
        elif new_status == BuildStatus.CHANGES_REQUESTED:
            _notify(build.assignee, "CHANGES_REQUESTED", f'Changes requested on "{build.title}".', f"/builds/{build.id}")
        return Response(BuildSerializer(build).data)

    @action(detail=True, methods=["post"], url_path="enable-portal")
    def enable_portal(self, request, pk=None):
        build = self.get_object()
        if not build.client_portal_token:
            build.client_portal_token = secrets.token_urlsafe(24)
        build.client_portal_enabled = True
        build.save(update_fields=["client_portal_token", "client_portal_enabled", "updated_at"])
        return Response({"token": build.client_portal_token, "enabled": True})

    @action(detail=True, methods=["get"])
    def progress(self, request, pk=None):
        build = self.get_object()
        total = build.tasks.count()
        done = build.tasks.filter(status="DONE").count()
        return Response({"total": total, "done": done, "percent": round(done * 100 / total) if total else 0})

    @action(detail=True, methods=["post"], url_path="generate-brief")
    def generate_brief(self, request, pk=None):
        build = self.get_object()
        if not build.meeting_notes.exists():
            return Response({"error": "Add meeting notes before generating a brief."}, status=http.HTTP_400_BAD_REQUEST)
        # Mark the latest note processing (the frontend polls ai_status), then run
        # the slow OpenAI call off the request path via Celery.
        latest_note = build.meeting_notes.order_by("-created_at").first()
        if latest_note:
            latest_note.ai_status = "processing"
            latest_note.save(update_fields=["ai_status"])
        from .tasks import generate_build_brief
        generate_build_brief.delay(build.id, request.user.id)
        return Response({"status": "processing"}, status=http.HTTP_202_ACCEPTED)

    @action(detail=True, methods=["post"], url_path="brief-qa-check")
    def brief_qa(self, request, pk=None):
        build = self.get_object()
        if not build.goals:
            return Response({"error": "Generate the brief before running a QA check."}, status=http.HTTP_400_BAD_REQUEST)
        from .tasks import run_build_qa
        run_build_qa.delay(build.id, request.user.id)
        return Response({"status": "processing"}, status=http.HTTP_202_ACCEPTED)


@api_view(["GET"])
@permission_classes(PERMS)
def my_builds(request):
    qs = Build.objects.select_related("client", "creator", "assignee")
    if not _is_manager(request.user):
        qs = qs.filter(assignee=request.user)
    status_param = request.query_params.get("status")
    if status_param:
        qs = qs.filter(status=status_param)
    return Response(BuildListSerializer(qs.order_by("-created_at"), many=True).data)


# ─── Tasks ────────────────────────────────────────────────────────────────────
class TaskViewSet(viewsets.ModelViewSet):
    queryset = Task.objects.select_related("assignee", "build").prefetch_related("documents__uploader", "comments__author").all()
    permission_classes = PERMS
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["build", "status", "type", "assignee"]
    search_fields = ["title", "description"]
    ordering_fields = ["created_at", "due_date"]
    ordering = ["created_at"]

    def get_serializer_class(self):
        return TaskCardSerializer if self.action == "list" else TaskSerializer

    def perform_create(self, serializer):
        task = serializer.save()
        if not task.assignee and task.build.assignee:
            task.assignee = task.build.assignee
            task.save(update_fields=["assignee"])
        _log(task.build, self.request.user, f'Task "{task.title}" added.')
        if task.assignee and task.assignee != self.request.user:
            _notify(
                task.assignee, "TASK_ASSIGNED",
                f'You were assigned the task "{task.title}".',
                f"/builds/{task.build_id}", actor=self.request.user, build_name=task.build.title,
            )

    def perform_update(self, serializer):
        prev_assignee_id = serializer.instance.assignee_id
        task = serializer.save()
        # Notify only when the assignee actually changes to a new person.
        if task.assignee_id and task.assignee_id != prev_assignee_id and task.assignee != self.request.user:
            _notify(
                task.assignee, "TASK_ASSIGNED",
                f'You were assigned the task "{task.title}".',
                f"/builds/{task.build_id}", actor=self.request.user, build_name=task.build.title,
            )

    @action(detail=True, methods=["post"], url_path="status")
    def set_status(self, request, pk=None):
        task = self.get_object()
        task.status = request.data.get("status", task.status)
        if "progress_note" in request.data:
            task.progress_note = request.data["progress_note"]
        task.save()
        _log(task.build, request.user, f'Task "{task.title}" → {task.status}.')
        actor_name = request.user.get_full_name() or request.user.username
        msg = f'{actor_name} updated task "{task.title}" to {task.status}.'
        if task.progress_note:
            msg += f" Note: {task.progress_note}"
        _notify(
            task.build.creator, "TASK_UPDATED", msg,
            f"/builds/{task.build_id}", actor=request.user, build_name=task.build.title,
        )
        return Response(TaskSerializer(task).data)

    @action(detail=True, methods=["post"], url_path="generate-sop")
    def generate_sop(self, request, pk=None):
        task = self.get_object()
        from .tasks import generate_task_sop
        generate_task_sop.delay(task.id)
        return Response({"status": "processing"}, status=http.HTTP_202_ACCEPTED)


# ─── Simple sub-resource viewsets ─────────────────────────────────────────────
class _BaseViewSet(viewsets.ModelViewSet):
    permission_classes = PERMS
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]


class ContactSourceViewSet(_BaseViewSet):
    queryset = ContactSource.objects.all()
    serializer_class = ContactSourceSerializer
    filterset_fields = ["build", "type"]


class PipelineStageViewSet(_BaseViewSet):
    queryset = PipelineStage.objects.prefetch_related("manual_actions").all()
    serializer_class = PipelineStageSerializer
    filterset_fields = ["build"]


class ManualActionViewSet(_BaseViewSet):
    queryset = ManualAction.objects.all()
    serializer_class = ManualActionSerializer
    filterset_fields = ["stage"]


class MeetingNoteViewSet(_BaseViewSet):
    queryset = MeetingNote.objects.all()
    serializer_class = MeetingNoteSerializer
    filterset_fields = ["build", "ai_status"]


class DocumentViewSet(_BaseViewSet):
    queryset = Document.objects.select_related("uploader").all()
    serializer_class = DocumentSerializer
    filterset_fields = ["build", "task"]

    def perform_create(self, serializer):
        doc = serializer.save(uploader=self.request.user)
        if doc.build:
            _log(doc.build, self.request.user, f'File "{doc.filename}" uploaded.')


class CommentViewSet(_BaseViewSet):
    queryset = Comment.objects.select_related("author").all()
    serializer_class = CommentSerializer
    filterset_fields = ["build", "task"]
    ordering = ["created_at"]

    def perform_create(self, serializer):
        comment = serializer.save(author=self.request.user)
        build = comment.build or (comment.task.build if comment.task else None)
        if build:
            _log(build, self.request.user, "New comment.")
            other = build.creator if self.request.user == build.assignee else build.assignee
            _notify(other, "NEW_COMMENT", "New comment on a build you're on.", f"/builds/{build.id}")


class ActivityViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Activity.objects.all()
    serializer_class = ActivitySerializer
    permission_classes = PERMS
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ["build"]
    ordering = ["-created_at"]


class ChangeRequestViewSet(_BaseViewSet):
    queryset = ChangeRequest.objects.select_related("owner", "created_by").all()
    serializer_class = ChangeRequestSerializer
    filterset_fields = ["build", "status"]

    def perform_create(self, serializer):
        cr = serializer.save(created_by=self.request.user)
        _log(cr.build, self.request.user, f'Change request "{cr.title}" raised.')
        _notify(cr.build.assignee, "CHANGE_REQUEST", f'Change request: "{cr.title}".', f"/builds/{cr.build_id}")

    @action(detail=True, methods=["post"], url_path="status")
    def set_status(self, request, pk=None):
        cr = self.get_object()
        cr.status = request.data.get("status", cr.status)
        cr.save(update_fields=["status", "updated_at"])
        _log(cr.build, request.user, f'Change request "{cr.title}" → {cr.status}.')
        return Response(ChangeRequestSerializer(cr).data)


class ApprovalRecordViewSet(_BaseViewSet):
    queryset = ApprovalRecord.objects.select_related("approver").all()
    serializer_class = ApprovalRecordSerializer
    filterset_fields = ["build", "type"]

    def perform_create(self, serializer):
        rec = serializer.save(approver=self.request.user)
        _log(rec.build, self.request.user, f"Approval recorded ({rec.type}).")


class BuildMemorySnapshotViewSet(_BaseViewSet):
    queryset = BuildMemorySnapshot.objects.select_related("created_by").all()
    serializer_class = BuildMemorySnapshotSerializer
    filterset_fields = ["build"]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class TaskDependencyViewSet(_BaseViewSet):
    queryset = TaskDependency.objects.all()
    serializer_class = TaskDependencySerializer
    filterset_fields = ["blocker", "blocked"]


# ─── Notifications ────────────────────────────────────────────────────────────
class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = NotificationSerializer
    permission_classes = PERMS
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ["read"]
    ordering = ["-created_at"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Notification.objects.none()
        return Notification.objects.filter(user=self.request.user)

    @action(detail=True, methods=["post"], url_path="mark-read")
    def mark_read(self, request, pk=None):
        n = self.get_object()
        n.read = True
        n.save(update_fields=["read"])
        return Response({"ok": True})

    @action(detail=False, methods=["post"], url_path="mark-all-read")
    def mark_all_read(self, request):
        self.get_queryset().filter(read=False).update(read=True)
        return Response({"ok": True})


@api_view(["GET", "PATCH"])
@permission_classes(PERMS)
def notification_preferences(request):
    pref, _ = NotificationPreference.objects.get_or_create(user=request.user)
    if request.method == "PATCH":
        ser = NotificationPreferenceSerializer(pref, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)
    return Response(NotificationPreferenceSerializer(pref).data)


# ─── AI API keys ──────────────────────────────────────────────────────────────
class AiApiKeyViewSet(viewsets.ModelViewSet):
    queryset = AiApiKey.objects.all()
    serializer_class = AiApiKeySerializer
    permission_classes = PERMS
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["provider", "active"]

    def create(self, request, *args, **kwargs):
        if not _is_manager(request.user):
            return Response({"error": "Permission denied"}, status=http.HTTP_403_FORBIDDEN)
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        plain = ser.validated_data.pop("api_key", "")
        try:
            encrypted, preview = services.encrypt_api_key(plain)
        except NotImplementedError as e:
            return _501(e)
        if ser.validated_data.get("active", True):
            AiApiKey.objects.filter(provider=ser.validated_data["provider"], active=True).update(active=False)
        ser.save(created_by=request.user, encrypted_key=encrypted, key_preview=preview)
        return Response(ser.data, status=http.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        key = self.get_object()
        AiApiKey.objects.filter(provider=key.provider, active=True).update(active=False)
        key.active = True
        key.updated_by = request.user
        key.save(update_fields=["active", "updated_by", "updated_at"])
        return Response({"ok": True})


# ─── Team invites ─────────────────────────────────────────────────────────────
class TeamInviteViewSet(viewsets.ModelViewSet):
    queryset = TeamInvite.objects.all()
    serializer_class = TeamInviteSerializer
    permission_classes = PERMS
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["email", "accepted_at"]

    def perform_create(self, serializer):
        import hashlib
        token = secrets.token_urlsafe(24)
        invite = serializer.save(
            invited_by=self.request.user,
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            expires_at=timezone.now() + timezone.timedelta(days=7),
        )
        frontend = getattr(settings, "FRONTEND_URL", "http://localhost:3000").rstrip("/")
        signup_url = f"{frontend}/signup/{token}"
        inviter = self.request.user.get_full_name() or self.request.user.username
        # Dispatch via Celery so the API response doesn't block on SMTP.
        try:
            send_notification_email.delay(
                recipient_email=invite.email,
                subject="You've been invited to Calari",
                context={
                    "recipient_name": invite.name,
                    "event_type": "project_assigned",
                    "event_title": f"{inviter} invited you to Calari",
                    "event_detail": "Set up your account to get started. This invite link expires in 7 days.",
                    "actor_name": inviter,
                    "project_name": "",
                    "portal_url": signup_url,
                    "year": timezone.now().year,
                },
            )
        except Exception:
            pass


# ─── Public client portal (token-based, no auth) ──────────────────────────────
@api_view(["GET"])
@permission_classes([AllowAny])
def portal_build(request, token):
    build = Build.objects.filter(client_portal_token=token, client_portal_enabled=True).first()
    if not build:
        return Response({"error": "Not found"}, status=http.HTTP_404_NOT_FOUND)
    return Response({
        "title": build.title,
        "status": build.status,
        "goals": build.goals,
        "integrations": build.integrations,
        "stages": PipelineStageSerializer(build.stages.all(), many=True).data,
        "tasks": TaskCardSerializer(build.tasks.all(), many=True).data,
    })


@api_view(["POST"])
@permission_classes([AllowAny])
def portal_feedback(request, token):
    build = Build.objects.filter(client_portal_token=token, client_portal_enabled=True).first()
    if not build:
        return Response({"error": "Not found"}, status=http.HTTP_404_NOT_FOUND)
    fb = ClientPortalFeedback.objects.create(
        build=build, name=request.data.get("name", ""), message=request.data.get("message", ""),
    )
    _notify(build.creator, "NEW_COMMENT", f'Client feedback on "{build.title}".', f"/builds/{build.id}")
    return Response(ClientPortalFeedbackSerializer(fb).data, status=http.HTTP_201_CREATED)


# ─── S3 uploads (presign + finalize) ──────────────────────────────────────────
@api_view(["POST"])
@permission_classes(PERMS)
def upload_presign(request):
    filename = request.data.get("filename")
    content_type = request.data.get("content_type", "application/octet-stream")
    if not filename:
        return Response({"error": "filename required"}, status=http.HTTP_400_BAD_REQUEST)
    try:
        return Response(services.presign_upload(filename, content_type))
    except Exception as e:  # noqa: BLE001
        return Response({"error": str(e)}, status=http.HTTP_502_BAD_GATEWAY)


@api_view(["POST"])
@permission_classes(PERMS)
def upload_finalize(request):
    """Create a Document row after the browser PUTs the file to S3."""
    data = request.data
    filename = data.get("filename", "")
    doc = Document.objects.create(
        filename=filename,
        url=data.get("public_url", ""),
        mime_type=data.get("content_type", ""),
        size_bytes=data.get("size_bytes"),
        ai_readable=services.is_ai_readable(filename, data.get("content_type", "")),
        build_id=data.get("build") or None,
        task_id=data.get("task") or None,
        uploader=request.user,
    )
    if doc.build:
        _log(doc.build, request.user, f'File "{doc.filename}" uploaded.')
        _notify(doc.build.creator if request.user != doc.build.creator else doc.build.assignee,
                "DOCUMENT_UPLOADED", f'File uploaded to "{doc.build.title}".', f"/builds/{doc.build_id}")
    return Response(DocumentSerializer(doc).data, status=http.HTTP_201_CREATED)
