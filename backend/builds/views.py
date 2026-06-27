import secrets
from datetime import date

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.db import transaction
from django.db.models import Count, Sum, Avg, Q
from django.utils import timezone

from projects.tasks import send_notification_email
from rest_framework import viewsets, status as http
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter

from .models import (
    Build, ContactSource, PipelineStage, ManualAction, Task, TaskDependency,
    Document, MeetingNote, Comment, Activity, ChangeRequest, ApprovalRecord,
    BuildMemorySnapshot, ClientPortalFeedback, Notification, NotificationPreference,
    AiApiKey, TeamInvite, BuildStatus, StageTransition, Workflow, CustomField,
    TagDefinition, PreLaunchItem, VisionGap, GapStatus, Calendar, Integration,
    ApprovalType, BuildKnowledge, AiConfig, AiGenerationLog, BuildSectionReview,
    BuildSection, BuildSectionReviewStatus,
)
from .serializers import (
    BuildSerializer, BuildListSerializer, ContactSourceSerializer, PipelineStageSerializer,
    ManualActionSerializer, TaskSerializer, TaskCardSerializer, TaskDependencySerializer,
    DocumentSerializer, MeetingNoteSerializer, CommentSerializer, ActivitySerializer,
    ChangeRequestSerializer, ApprovalRecordSerializer, BuildMemorySnapshotSerializer,
    ClientPortalFeedbackSerializer, NotificationSerializer, NotificationPreferenceSerializer,
    AiApiKeySerializer, TeamInviteSerializer, StageTransitionSerializer, WorkflowSerializer,
    CustomFieldSerializer, TagDefinitionSerializer, PreLaunchItemSerializer, VisionGapSerializer,
    CalendarSerializer, IntegrationSerializer, BuildKnowledgeSerializer, AiConfigSerializer,
    BuildSectionReviewSerializer,
)
from . import services
from .permissions import IsManagerOrBuildOwner, IsManagerOrBuildTaskOwner

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
    "SECTION_BLOCKED": "change_requests",
    "SECTION_DONE": "task_updated",
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
    "SECTION_BLOCKED": "blocker_added",
    "SECTION_DONE": "task_status_changed",
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


# Relations whose rows carry ai_generated/locked — used for the AI-quality metric.
_QUALITY_RELATIONS = (
    "stages", "workflows", "contact_sources", "calendars", "external_integrations",
    "transitions", "custom_fields", "tags", "pre_launch_items", "tasks",
)


def _build_quality(build):
    """AI-acceptance metric (edit-distance proxy): how much of the AI's build-out
    survived to approval unedited. Lower edits over time = the AI getting smarter."""
    ai = edited = human = 0
    for rel in _QUALITY_RELATIONS:
        for obj in getattr(build, rel).all():
            if getattr(obj, "ai_generated", False):
                ai += 1
                if getattr(obj, "locked", False):
                    edited += 1
            else:
                human += 1
    kept = ai - edited
    return {
        "ai_items": ai, "edited": edited, "human_added": human, "kept": kept,
        "kept_pct": round(kept * 100 / ai) if ai else 0,
        "gaps_total": build.gaps.count(),
        "gaps_resolved": build.gaps.exclude(status=GapStatus.OPEN).count(),
    }


def _dispatch_async(task_fn, *args):
    """Queue a Celery task. Returns a clean 503 Response if the broker (Redis) is
    unreachable, instead of letting the connection error bubble up as a 500."""
    try:
        task_fn.delay(*args)
        return None
    except Exception:  # noqa: BLE001 — kombu/redis OperationalError, ConnectionError, etc.
        return Response(
            {"error": "Background processing is temporarily unavailable (task queue offline). "
                      "Please try again shortly."},
            status=http.HTTP_503_SERVICE_UNAVAILABLE,
        )


# ─── Builds ───────────────────────────────────────────────────────────────────
# Relations the detail page renders — each is a separate round-trip to the DB,
# so we only load them for `retrieve` (and the generate-brief response), never
# for list/mutating actions which otherwise paid the full prefetch cost.
_DETAIL_PREFETCH = (
    "contact_sources__entry_stage", "calendars__books_into_stage", "external_integrations",
    "stages__manual_actions", "transitions",
    "workflows", "custom_fields", "tags", "pre_launch_items", "gaps",
    "tasks__assignee", "documents__uploader", "comments__author",
    "change_requests__owner", "change_requests__created_by",
    "approvals__approver", "section_reviews__completed_by", "section_reviews__blocked_by",
    "memory_snapshots__created_by", "activities",
)


class BuildViewSet(viewsets.ModelViewSet):
    queryset = Build.objects.select_related("client", "creator", "assignee").all()
    # Reads open to all staff; writes (incl. assign/status/delete/AI actions)
    # require a manager, the creator, or the assignee.
    permission_classes = [IsManagerOrBuildOwner]
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

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, pk=None):
        """Admin approves the AI build-out and hands it to staff to implement.

        Records a BRIEF approval, assigns the build, moves it to ASSIGNED, and
        notifies the assignee. This is the gate between the AI draft and staff
        starting the build.
        """
        if not _is_manager(request.user):
            return Response({"error": "Only admins can approve a build-out."}, status=http.HTTP_403_FORBIDDEN)
        build = self.get_object()
        assignee = User.objects.filter(id=request.data.get("assignee_id")).first() or build.assignee
        if not assignee:
            return Response(
                {"error": "Assign a staff member before approving."},
                status=http.HTTP_400_BAD_REQUEST,
            )
        build.assignee = assignee
        build.status = BuildStatus.ASSIGNED
        build.save(update_fields=["assignee", "status", "updated_at"])
        ApprovalRecord.objects.create(
            build=build, approver=request.user, type=ApprovalType.BRIEF,
            note=(request.data.get("note") or "").strip() or "Build-out approved — handed to staff.",
        )
        # Capture the AI-acceptance metric at the moment of approval (quality signal).
        q = _build_quality(build)
        BuildMemorySnapshot.objects.create(
            build=build, created_by=request.user, created_by_ai=False,
            summary=f"Approved — AI quality: {q['kept']}/{q['ai_items']} AI items kept unedited ({q['kept_pct']}%).",
            scope_changes=f"{q['edited']} AI item(s) edited, {q['human_added']} human-added, "
                          f"{q['gaps_resolved']}/{q['gaps_total']} gaps resolved.",
        )
        _log(build, request.user, f"Build-out approved and handed to {assignee.get_full_name() or assignee.username}.")
        _notify(
            assignee, "BUILD_ASSIGNED",
            f'Build "{build.title}" approved — ready to implement.',
            f"/builds/{build.id}", actor=request.user, build_name=build.title,
        )
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

    @action(detail=True, methods=["get"])
    def handover(self, request, pk=None):
        """Render the captured vision blueprint as the client handover document (markdown)."""
        build = self._detail_queryset().get(pk=self.get_object().pk)
        try:
            markdown = services.render_handover_markdown(build)
        except Exception:  # noqa: BLE001 — never 500 the preview; return a soft message
            markdown = "_The handover could not be rendered for this build yet._"
        return Response({"markdown": markdown})

    @action(detail=True, methods=["get"], url_path="build-document")
    def build_document(self, request, pk=None):
        """Generate the long-form, step-by-step GHL IMPLEMENTATION build document (markdown).

        Heavier than the handover (this makes one AI call) and meant for the assigned builder
        to follow directly in GHL. Grounded in the captured blueprint + the original meeting
        notes + the Build-Library learning loop.
        """
        build = self._detail_queryset().get(pk=self.get_object().pk)
        try:
            markdown = services.generate_build_document(build)
        except Exception:  # noqa: BLE001 — never 500 the request; return a soft message
            markdown = "_The build document could not be generated yet._"
        return Response({"markdown": markdown})

    @action(detail=True, methods=["get"], url_path="vision-completeness")
    def vision_completeness(self, request, pk=None):
        """Score how fully the client vision is captured, by handover section."""
        build = self.get_object()
        sections = {
            "overview": bool(build.overview),
            "lead_sources": build.contact_sources.exists(),
            "calendars": build.calendars.exists(),
            "integrations": build.external_integrations.exists(),
            "stages": build.stages.exists(),
            "transitions": build.transitions.exists(),
            "workflows": build.workflows.exists(),
            "custom_fields": build.custom_fields.exists(),
            "tags": build.tags.exists(),
        }
        captured = sum(1 for v in sections.values() if v)
        return Response({
            "sections": sections,
            "captured": captured,
            "total": len(sections),
            "percent": round(captured * 100 / len(sections)),
            "open_gaps": build.gaps.filter(status=GapStatus.OPEN).count(),
        })

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
        err = _dispatch_async(generate_build_brief, build.id, request.user.id)
        if err:
            if latest_note:  # don't leave the UI stuck on "processing"
                latest_note.ai_status = "failed"
                latest_note.save(update_fields=["ai_status"])
            return err
        return Response({"status": "processing"}, status=http.HTTP_202_ACCEPTED)

    @action(detail=True, methods=["post"], url_path="progress-update")
    def progress_update(self, request, pk=None):
        """Log a follow-up/progress meeting as a DELTA: captures scope changes
        (→ change requests), new questions (→ gaps), progress, and refreshes the
        build's living memory — without rewriting the blueprint."""
        build = self.get_object()
        text = (request.data.get("raw_text") or "").strip()
        if not text:
            return Response({"error": "Meeting notes are required."}, status=http.HTTP_400_BAD_REQUEST)
        kind = request.data.get("kind") or "progress"
        if kind not in ("progress", "change_request"):
            kind = "progress"
        note = MeetingNote.objects.create(build=build, raw_text=text, source="paste", kind=kind, ai_status="processing")
        note.title = services.auto_note_title(build, kind)
        note.save(update_fields=["title"])
        _log(build, request.user, f"{note.title} logged.")
        from .tasks import apply_progress_update
        err = _dispatch_async(apply_progress_update, build.id, note.id, request.user.id)
        if err:
            note.ai_status = "failed"
            note.save(update_fields=["ai_status"])
            return err
        return Response({"status": "processing", "note": MeetingNoteSerializer(note).data}, status=http.HTTP_202_ACCEPTED)

    @action(detail=True, methods=["post"], url_path="brief-qa-check")
    def brief_qa(self, request, pk=None):
        build = self.get_object()
        if not build.goals:
            return Response({"error": "Generate the brief before running a QA check."}, status=http.HTTP_400_BAD_REQUEST)
        from .tasks import run_build_qa
        return _dispatch_async(run_build_qa, build.id, request.user.id) or \
            Response({"status": "processing"}, status=http.HTTP_202_ACCEPTED)


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
    permission_classes = [IsManagerOrBuildTaskOwner]
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
        return _dispatch_async(generate_task_sop, task.id) or \
            Response({"status": "processing"}, status=http.HTTP_202_ACCEPTED)


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
    filterset_fields = ["build", "ai_status", "kind"]
    ordering = ["created_at"]

    def perform_create(self, serializer):
        note = serializer.save()
        if not note.title:  # auto-label: "Kickoff meeting notes", "2nd Meeting notes", …
            note.title = services.auto_note_title(note.build, note.kind)
            note.save(update_fields=["title"])
        _log(note.build, self.request.user, f"{note.title} added.")

    @action(detail=False, methods=["post"], url_path="upload",
            parser_classes=[MultiPartParser, FormParser])
    def upload(self, request):
        """Create a meeting note from an uploaded document (PDF, DOCX, TXT, …).

        The file's text is extracted server-side and stored as the note body so the
        AI blueprint step can read it — same as a pasted note, but from a file.
        """
        build = Build.objects.filter(pk=request.data.get("build")).first()
        file = request.FILES.get("file")
        if not build or not file:
            return Response({"error": "build and file are required"}, status=http.HTTP_400_BAD_REQUEST)
        filename = file.name
        content_type = getattr(file, "content_type", "") or ""
        if not services.is_ai_readable(filename, content_type):
            return Response(
                {"error": "Unsupported file type. Upload a PDF, DOCX, TXT, CSV, MD, or RTF file."},
                status=http.HTTP_400_BAD_REQUEST,
            )
        raw = file.read()
        try:
            text = services.extract_text(raw, filename, content_type)
        except Exception as e:  # noqa: BLE001
            return Response({"error": f"Could not read the document: {e}"}, status=http.HTTP_400_BAD_REQUEST)
        if not text.strip():
            return Response(
                {"error": "No readable text was found in that document."},
                status=http.HTTP_400_BAD_REQUEST,
            )
        # Keep the original file too (best-effort — the extracted text is what the AI reads).
        file_url = ""
        try:
            from django.core.files.storage import default_storage
            from django.core.files.base import ContentFile
            key = default_storage.save(f"meeting_notes/{secrets.token_urlsafe(8)}_{filename}", ContentFile(raw))
            file_url = default_storage.url(key)
        except Exception:  # noqa: BLE001 — storage is optional; never block note creation
            pass
        kind = request.data.get("kind") or "meeting"
        note = MeetingNote.objects.create(build=build, raw_text=text, source="upload", file_url=file_url, kind=kind)
        note.title = services.auto_note_title(build, kind)
        note.save(update_fields=["title"])
        _log(build, request.user, f'{note.title} uploaded from "{filename}".')
        return Response(MeetingNoteSerializer(note).data, status=http.HTTP_201_CREATED)


class BuildKnowledgeViewSet(_BaseViewSet):
    """Shared Build Library — any staff member uploads past-build / client docs the
    AI learns from. Text is extracted on upload and fed into blueprint generation."""
    queryset = BuildKnowledge.objects.select_related("client", "build", "uploaded_by").all()
    serializer_class = BuildKnowledgeSerializer
    filterset_fields = ["client", "build", "use_for_ai"]
    search_fields = ["title", "summary", "filename"]
    ordering_fields = ["created_at", "title"]
    ordering = ["-created_at"]

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)

    @action(detail=False, methods=["post"], url_path="upload",
            parser_classes=[MultiPartParser, FormParser])
    def upload(self, request):
        """Upload a build/client doc; its text is extracted and stored for AI context."""
        file = request.FILES.get("file")
        if not file:
            return Response({"error": "file is required"}, status=http.HTTP_400_BAD_REQUEST)
        filename = file.name
        content_type = getattr(file, "content_type", "") or ""
        if not services.is_ai_readable(filename, content_type):
            return Response(
                {"error": "Unsupported file type. Upload a PDF, DOCX, TXT, CSV, MD, or RTF file."},
                status=http.HTTP_400_BAD_REQUEST,
            )
        raw = file.read()
        try:
            text = services.extract_text(raw, filename, content_type)
        except Exception as e:  # noqa: BLE001
            return Response({"error": f"Could not read the document: {e}"}, status=http.HTTP_400_BAD_REQUEST)
        if not text.strip():
            return Response({"error": "No readable text was found in that document."}, status=http.HTTP_400_BAD_REQUEST)
        file_url = ""
        try:
            from django.core.files.storage import default_storage
            from django.core.files.base import ContentFile
            key = default_storage.save(f"knowledge/{secrets.token_urlsafe(8)}_{filename}", ContentFile(raw))
            file_url = default_storage.url(key)
        except Exception:  # noqa: BLE001 — storage optional; never block the upload
            pass
        kn = BuildKnowledge.objects.create(
            title=(request.data.get("title") or "").strip() or filename,
            client_id=(request.data.get("client") or None),
            build_id=(request.data.get("build") or None),
            filename=filename, file_url=file_url, raw_text=text,
            summary=(request.data.get("summary") or "").strip(),
            use_for_ai=str(request.data.get("use_for_ai", "true")).lower() in ("1", "true", "yes", "on"),
            uploaded_by=request.user,
        )
        return Response(BuildKnowledgeSerializer(kn).data, status=http.HTTP_201_CREATED)


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


class BuildSectionReviewViewSet(_BaseViewSet):
    queryset = BuildSectionReview.objects.select_related("build", "completed_by", "blocked_by").all()
    serializer_class = BuildSectionReviewSerializer
    filterset_fields = ["build", "section", "status"]

    @action(detail=False, methods=["post"], url_path="upsert")
    def upsert(self, request):
        build = Build.objects.select_related("creator", "assignee").filter(pk=request.data.get("build")).first()
        section = request.data.get("section")
        status = request.data.get("status")
        if not build or section not in BuildSection.values:
            return Response({"error": "Valid build and section are required."}, status=http.HTTP_400_BAD_REQUEST)
        if status not in BuildSectionReviewStatus.values:
            return Response({"error": "Valid status is required."}, status=http.HTTP_400_BAD_REQUEST)
        if not (_is_manager(request.user) or build.creator_id == request.user.id or build.assignee_id == request.user.id):
            return Response({"error": "Permission denied"}, status=http.HTTP_403_FORBIDDEN)
        if status == BuildSectionReviewStatus.BLOCKED and not (request.data.get("blocker_note") or "").strip():
            return Response({"error": "Blocker details are required."}, status=http.HTTP_400_BAD_REQUEST)

        review, _ = BuildSectionReview.objects.get_or_create(build=build, section=section)
        review.status = status
        section_label = BuildSection(section).label
        if status == BuildSectionReviewStatus.DONE:
            review.blocker_note = ""
            review.blocker_attachment_url = ""
            review.blocker_attachment_name = ""
            review.completed_by = request.user
            review.completed_at = timezone.now()
            review.blocked_by = None
            review.blocked_at = None
            message = f'{section_label} marked done.'
            notify_type = "SECTION_DONE"
            notify_user = build.creator if request.user != build.creator else build.assignee
        elif status == BuildSectionReviewStatus.BLOCKED:
            review.blocker_note = (request.data.get("blocker_note") or "").strip()
            review.blocker_attachment_url = (request.data.get("blocker_attachment_url") or "").strip()
            review.blocker_attachment_name = (request.data.get("blocker_attachment_name") or "").strip()
            review.blocked_by = request.user
            review.blocked_at = timezone.now()
            review.completed_by = None
            review.completed_at = None
            message = f'{section_label} blocked: {review.blocker_note[:160]}'
            notify_type = "SECTION_BLOCKED"
            notify_user = build.creator if request.user != build.creator else build.assignee
        else:
            review.blocker_note = ""
            review.blocker_attachment_url = ""
            review.blocker_attachment_name = ""
            review.completed_by = None
            review.completed_at = None
            review.blocked_by = None
            review.blocked_at = None
            message = f'{section_label} reset to to do.'
            notify_type = "TASK_UPDATED"
            notify_user = build.creator if request.user != build.creator else build.assignee
        review.save()
        _log(build, request.user, message)
        _notify(
            notify_user,
            notify_type,
            f'"{build.title}" — {message}',
            f"/builds/{build.id}",
            actor=request.user,
            build_name=build.title,
        )
        return Response(BuildSectionReviewSerializer(review).data)


# ─── Vision blueprint sub-resources ───────────────────────────────────────────
class CalendarViewSet(_BaseViewSet):
    queryset = Calendar.objects.all()
    serializer_class = CalendarSerializer
    filterset_fields = ["build", "type", "books_into_stage"]
    ordering = ["order"]


class IntegrationViewSet(_BaseViewSet):
    queryset = Integration.objects.all()
    serializer_class = IntegrationSerializer
    filterset_fields = ["build", "direction", "mechanism"]
    ordering = ["order"]


class StageTransitionViewSet(_BaseViewSet):
    queryset = StageTransition.objects.all()
    serializer_class = StageTransitionSerializer
    filterset_fields = ["build", "from_stage", "to_stage"]
    ordering = ["order"]


class WorkflowViewSet(_BaseViewSet):
    queryset = Workflow.objects.all()
    serializer_class = WorkflowSerializer
    filterset_fields = ["build", "category", "patient_facing"]
    ordering = ["category", "order"]


class CustomFieldViewSet(_BaseViewSet):
    queryset = CustomField.objects.all()
    serializer_class = CustomFieldSerializer
    filterset_fields = ["build", "kind", "populated"]
    ordering = ["kind", "order"]


class TagDefinitionViewSet(_BaseViewSet):
    queryset = TagDefinition.objects.all()
    serializer_class = TagDefinitionSerializer
    filterset_fields = ["build"]
    ordering = ["order"]


class PreLaunchItemViewSet(_BaseViewSet):
    queryset = PreLaunchItem.objects.all()
    serializer_class = PreLaunchItemSerializer
    filterset_fields = ["build", "done", "optional"]
    ordering = ["order"]


class VisionGapViewSet(_BaseViewSet):
    queryset = VisionGap.objects.select_related("resolved_by").all()
    serializer_class = VisionGapSerializer
    filterset_fields = ["build", "status", "category", "severity"]
    ordering = ["status", "created_at"]

    @action(detail=True, methods=["post"])
    def suggest(self, request, pk=None):
        """AI-suggested answer options for an open gap — the team picks one or edits."""
        gap = self.get_object()
        try:
            options = services.suggest_gap_answers(gap.build, gap.question, gap.rationale)
        except Exception:  # noqa: BLE001 — never 500 the suggest button
            return Response(
                {"error": "Could not generate suggestions right now. Type an answer instead."},
                status=http.HTTP_502_BAD_GATEWAY,
            )
        return Response({"options": options})

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        """Answer or dismiss a gap the AI flagged, closing the loop on the vision."""
        gap = self.get_object()
        new_status = request.data.get("status", GapStatus.ANSWERED)
        if new_status not in GapStatus.values:
            return Response({"error": "invalid status"}, status=http.HTTP_400_BAD_REQUEST)
        gap.status = new_status
        gap.answer = request.data.get("answer", gap.answer)
        gap.resolved_by = request.user
        gap.save(update_fields=["status", "answer", "resolved_by", "updated_at"])
        _log(gap.build, request.user, f"Vision gap {new_status.lower()}: {gap.question[:80]}")
        return Response(VisionGapSerializer(gap).data)


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


# Rough USD per 1M tokens (input, output). Estimates — update as provider pricing
# changes; models not listed report tokens only (cost omitted).
_AI_PRICES = {
    "gpt-4o": (2.5, 10.0),
    "gpt-4o-mini": (0.15, 0.6),
    "text-embedding-3-small": (0.02, 0.0),
    "text-embedding-3-large": (0.13, 0.0),
    "claude-opus-4-8": (15.0, 75.0),
}


def _estimate_cost(model_rows) -> float | None:
    total, known = 0.0, False
    for r in model_rows:
        price = _AI_PRICES.get(r.get("model"))
        if not price:
            continue
        known = True
        total += (r.get("prompt") or 0) / 1e6 * price[0] + (r.get("completion") or 0) / 1e6 * price[1]
    return round(total, 4) if known else None


@api_view(["GET"])
@permission_classes(PERMS)
def ai_usage(request):
    """AI telemetry rollup (managers only): tokens / latency / success / est. cost
    over a window, broken down by operation and model."""
    if not _is_manager(request.user):
        return Response({"error": "Permission denied"}, status=http.HTTP_403_FORBIDDEN)
    try:
        days = max(1, min(int(request.query_params.get("days", 30)), 365))
    except (TypeError, ValueError):
        days = 30
    since = timezone.now() - timezone.timedelta(days=days)
    qs = AiGenerationLog.objects.filter(created_at__gte=since)

    totals = qs.aggregate(
        calls=Count("id"), ok=Count("id", filter=Q(ok=True)),
        total_tokens=Sum("total_tokens"), prompt_tokens=Sum("prompt_tokens"),
        completion_tokens=Sum("completion_tokens"), avg_latency_ms=Avg("latency_ms"),
    )
    by_op = list(qs.values("op").annotate(
        calls=Count("id"), tokens=Sum("total_tokens"), avg_latency_ms=Avg("latency_ms"),
        ok=Count("id", filter=Q(ok=True)),
    ).order_by("-calls"))
    by_model = list(qs.values("provider", "model").annotate(
        calls=Count("id"), tokens=Sum("total_tokens"),
        prompt=Sum("prompt_tokens"), completion=Sum("completion_tokens"),
    ).order_by("-tokens"))

    def _round_latency(rows):
        for r in rows:
            if r.get("avg_latency_ms") is not None:
                r["avg_latency_ms"] = round(r["avg_latency_ms"])
        return rows

    calls = totals["calls"] or 0
    return Response({
        "days": days,
        "totals": {
            "calls": calls,
            "ok_rate": round((totals["ok"] or 0) * 100 / calls) if calls else 100,
            "total_tokens": totals["total_tokens"] or 0,
            "prompt_tokens": totals["prompt_tokens"] or 0,
            "completion_tokens": totals["completion_tokens"] or 0,
            "avg_latency_ms": round(totals["avg_latency_ms"]) if totals["avg_latency_ms"] else 0,
            "estimated_cost_usd": _estimate_cost(by_model),
        },
        "by_op": _round_latency(by_op),
        "by_model": [{"provider": r["provider"], "model": r["model"], "calls": r["calls"], "tokens": r["tokens"]} for r in by_model],
    })


@api_view(["GET", "PATCH"])
@permission_classes(PERMS)
def ai_config(request):
    """Read/update the active AI provider + model used for generation (managers only)."""
    if not _is_manager(request.user):
        return Response({"error": "Permission denied"}, status=http.HTTP_403_FORBIDDEN)
    cfg = AiConfig.get_solo()
    if request.method == "PATCH":
        ser = AiConfigSerializer(cfg, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save(updated_by=request.user)
        return Response(ser.data)
    return Response(AiConfigSerializer(cfg).data)


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
        u = request.user
        if not (_is_manager(u) or (hasattr(u, "has_feature") and u.has_feature("ai_keys"))):
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
        self._send_invite_email(invite, token)

    def _send_invite_email(self, invite, token):
        """Email the signup link via Celery so the API response never blocks on SMTP."""
        frontend = getattr(settings, "FRONTEND_URL", "http://localhost:3000").rstrip("/")
        signup_url = f"{frontend}/signup/{token}"
        inviter = self.request.user.get_full_name() or self.request.user.username
        try:
            send_notification_email.delay(
                recipient_email=invite.email,
                subject="You've been invited to Calari",
                context={
                    "recipient_name": invite.name,
                    "event_type": "invite",
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

    @action(detail=True, methods=["post"], url_path="resend")
    def resend(self, request, pk=None):
        """Re-issue a fresh token + 7-day expiry and re-send the invite email.
        Rotating the token invalidates any previously emailed link."""
        import hashlib
        invite = self.get_object()
        if invite.accepted_at:
            return Response({"detail": "This invite was already accepted."}, status=http.HTTP_400_BAD_REQUEST)
        token = secrets.token_urlsafe(24)
        invite.token_hash = hashlib.sha256(token.encode()).hexdigest()
        invite.expires_at = timezone.now() + timezone.timedelta(days=7)
        invite.save(update_fields=["token_hash", "expires_at"])
        self._send_invite_email(invite, token)
        return Response({"ok": True})


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


# ─── Team invite acceptance (public, token-based) ─────────────────────────────
def _lookup_invite(token):
    import hashlib
    th = hashlib.sha256(token.encode()).hexdigest()
    invite = TeamInvite.objects.filter(token_hash=th, accepted_at__isnull=True).first()
    if not invite or (invite.expires_at and invite.expires_at < timezone.now()):
        return None
    return invite


@api_view(["GET"])
@permission_classes([AllowAny])
def invite_detail(request, token):
    invite = _lookup_invite(token)
    if not invite:
        return Response({"valid": False, "error": "This invite link is invalid or has expired."}, status=http.HTTP_404_NOT_FOUND)
    return Response({"valid": True, "email": invite.email, "name": invite.name, "role": invite.role})


@api_view(["POST"])
@permission_classes([AllowAny])
def invite_accept(request, token):
    invite = _lookup_invite(token)
    if not invite:
        return Response({"error": "This invite link is invalid or has expired."}, status=http.HTTP_400_BAD_REQUEST)
    password = request.data.get("password") or ""
    if len(password) < 8:
        return Response({"error": "Password must be at least 8 characters."}, status=http.HTTP_400_BAD_REQUEST)
    User = get_user_model()
    if User.objects.filter(email__iexact=invite.email).exists():
        return Response({"error": "An account with this email already exists — try signing in."}, status=http.HTTP_400_BAD_REQUEST)

    # Derive a unique username from the email local-part.
    base = (invite.email.split("@")[0] or "user").lower()
    username, i = base, 1
    while User.objects.filter(username=username).exists():
        username, i = f"{base}{i}", i + 1

    User.objects.create_user(
        username=username, email=invite.email, password=password,
        full_name=invite.name, role=invite.role or "employee",
    )
    invite.accepted_at = timezone.now()
    invite.save(update_fields=["accepted_at"])
    return Response({"success": True, "message": "Account created — you can now sign in."}, status=http.HTTP_201_CREATED)
