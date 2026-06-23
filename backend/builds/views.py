import secrets

from django.contrib.auth import get_user_model
from django.utils import timezone
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


def _notify(user, type_, message, link):
    """Create an in-app notification, honoring the user's preferences."""
    if not user:
        return
    pref = getattr(user, "notification_preference", None)
    pref_map = {
        "BUILD_ASSIGNED": "build_assigned",
        "TASK_UPDATED": "task_updated",
        "MEETING_NOTE_ADDED": "follow_up_notes",
        "CHANGE_REQUEST": "change_requests",
        "READY_FOR_REVIEW": "ready_for_review",
        "CHANGES_REQUESTED": "ready_for_review",
        "DOCUMENT_UPLOADED": "document_uploaded",
    }
    if pref and not getattr(pref, pref_map.get(type_, ""), True):
        return
    Notification.objects.create(user=user, type=type_, message=message, link=link)


def _501(exc):
    return Response({"error": str(exc)}, status=http.HTTP_501_NOT_IMPLEMENTED)


# ─── Builds ───────────────────────────────────────────────────────────────────
class BuildViewSet(viewsets.ModelViewSet):
    queryset = Build.objects.select_related("client", "creator", "assignee").prefetch_related(
        "contact_sources", "stages__manual_actions", "tasks", "documents", "comments",
        "change_requests", "approvals", "memory_snapshots", "activities",
    ).all()
    permission_classes = PERMS
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["status", "assignee", "client"]
    search_fields = ["title", "goals", "integrations", "client__name"]
    ordering_fields = ["created_at", "updated_at", "due_date"]
    ordering = ["-created_at"]

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
        notes = "\n\n".join(build.meeting_notes.values_list("raw_text", flat=True))
        try:
            draft = services.generate_brief_draft(notes)
        except NotImplementedError as e:
            return _501(e)
        return Response(draft)  # persistence wired in Phase 2d

    @action(detail=True, methods=["post"], url_path="brief-qa-check")
    def brief_qa(self, request, pk=None):
        try:
            return Response(services.run_brief_qa(self.get_object()))
        except NotImplementedError as e:
            return _501(e)


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
    queryset = Task.objects.select_related("assignee", "build").prefetch_related("documents", "comments").all()
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

    @action(detail=True, methods=["post"], url_path="status")
    def set_status(self, request, pk=None):
        task = self.get_object()
        task.status = request.data.get("status", task.status)
        if "progress_note" in request.data:
            task.progress_note = request.data["progress_note"]
        task.save()
        _log(task.build, request.user, f'Task "{task.title}" → {task.status}.')
        _notify(task.build.creator, "TASK_UPDATED", f'Task "{task.title}" updated to {task.status}.', f"/builds/{task.build_id}")
        return Response(TaskSerializer(task).data)

    @action(detail=True, methods=["post"], url_path="generate-sop")
    def generate_sop(self, request, pk=None):
        try:
            return Response({"sop": services.generate_task_sop(self.get_object())})
        except NotImplementedError as e:
            return _501(e)


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
        serializer.save(
            invited_by=self.request.user,
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            expires_at=timezone.now() + timezone.timedelta(days=7),
        )
        # NOTE: emailing the raw token link is wired in Phase 2d.


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
