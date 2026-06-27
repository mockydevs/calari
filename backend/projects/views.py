import logging
from datetime import date

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import viewsets, status as drf_status
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.exceptions import APIException
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from drf_spectacular.utils import extend_schema, extend_schema_view, OpenApiResponse, OpenApiParameter

try:  # botocore ships with boto3; guard so a missing dep never breaks import
    from botocore.exceptions import BotoCoreError, ClientError
except Exception:  # noqa: BLE001
    BotoCoreError = ClientError = ()

logger = logging.getLogger(__name__)
User = get_user_model()


class StorageUnavailable(APIException):
    """Returned when the file-storage backend (S3 or filesystem) fails a write."""
    status_code = drf_status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = (
        "File storage is unavailable — the server's S3/media storage is not configured "
        "correctly. The file was not saved."
    )
    default_code = "storage_unavailable"


class FileUploadMixin:
    """Translate raw storage failures into a clean 503 instead of an opaque 500."""

    def create(self, request, *args, **kwargs):
        try:
            return super().create(request, *args, **kwargs)
        except (BotoCoreError, ClientError, ValueError, OSError) as exc:
            logger.exception("File upload failed during storage write: %s", exc)
            raise StorageUnavailable()

from .models import (
    Clients, Projects, ProjectFiles, ProjectContactPerson, projectBlockers,
    ProjectCoAssignment, ProjectMilestone, ProjectActivity,
    Tasks, TaskFiles, TaskBlockers, TaskLabel, TaskComment, TaskChecklist, TaskActivity,
)
from .serializers import (
    ClientsSerializer, ProjectsSerializer, ProjectListSerializer,
    ProjectFilesSerializer, ProjectContactPersonSerializer, ProjectBlockersSerializer,
    ProjectCoAssignmentSerializer, ProjectMilestoneSerializer, ProjectActivitySerializer,
    TasksSerializer, TaskCardSerializer, TaskFilesSerializer, TaskBlockersSerializer,
    TaskLabelSerializer, TaskCommentSerializer, TaskChecklistSerializer, TaskActivitySerializer,
)
from .tasks import send_notification_email
from .permissions import (
    IsManagerOrProjectMember, IsManagerOrTaskOwner, IsManagerOrReadOnly,
)

# Use IsAuthenticated always (security-first; DEBUG open-access removed)
_PERMISSIONS = [IsAuthenticated]


def _log_project_activity(project, user, action, detail=''):
    ProjectActivity.objects.create(project=project, user=user, action=action, detail=detail)


def _log_task_activity(task, user, action, detail=''):
    TaskActivity.objects.create(task=task, user=user, action=action, detail=detail)


def _is_manager(user):
    return user.is_superuser or user.role in ('superuser', 'admin')


def _get_project_team(project, exclude_user=None):
    """Return the set of active staff on a project, optionally excluding one user."""
    members = set()
    if project.assigned_to and project.assigned_to != exclude_user:
        if project.assigned_to.email and project.assigned_to.is_active:
            members.add(project.assigned_to)
    for ca in project.co_assignments.select_related('user').all():
        if ca.user != exclude_user and ca.user.email and ca.user.is_active:
            members.add(ca.user)
    return members


def _notify(recipient, subject, event_type, event_title, event_detail, actor, project_name, portal_url):
    """Dispatch a single notification email as a Celery task (fire-and-forget)."""
    if not getattr(recipient, 'email', None):
        return
    send_notification_email.delay(
        recipient_email=recipient.email,
        subject=subject,
        context={
            'recipient_name': recipient.display_name,
            'event_type': event_type,
            'event_title': event_title,
            'event_detail': event_detail,
            'actor_name': actor.display_name,
            'project_name': project_name,
            'portal_url': portal_url,
            'year': date.today().year,
        },
    )


# ─────────────────────────────────────────────────────────────
# Clients
# ─────────────────────────────────────────────────────────────
@extend_schema_view(
    list=extend_schema(tags=['Clients'], summary='List all clients'),
    retrieve=extend_schema(tags=['Clients'], summary='Retrieve a client'),
    create=extend_schema(tags=['Clients'], summary='Create a client'),
    update=extend_schema(tags=['Clients'], summary='Update a client'),
    partial_update=extend_schema(tags=['Clients'], summary='Partially update a client'),
    destroy=extend_schema(tags=['Clients'], summary='Delete a client'),
)
class ClientsViewSet(viewsets.ModelViewSet):
    queryset = Clients.objects.all()
    serializer_class = ClientsSerializer
    # Clients have no per-user owner — anyone may read, only managers may write.
    permission_classes = [IsManagerOrReadOnly]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['is_active']
    search_fields = ['name', 'email', 'phone_number', 'company_name']
    ordering_fields = ['name', 'created_at']
    ordering = ['-created_at']


# ─────────────────────────────────────────────────────────────
# Projects
# ─────────────────────────────────────────────────────────────
@extend_schema_view(
    list=extend_schema(tags=['Projects'], summary='List all projects'),
    retrieve=extend_schema(tags=['Projects'], summary='Retrieve a project'),
    create=extend_schema(tags=['Projects'], summary='Create a project'),
    update=extend_schema(tags=['Projects'], summary='Update a project'),
    partial_update=extend_schema(tags=['Projects'], summary='Partially update a project'),
    destroy=extend_schema(tags=['Projects'], summary='Delete a project'),
)
class ProjectsViewSet(viewsets.ModelViewSet):
    queryset = Projects.objects.select_related('client', 'assigned_to').prefetch_related(
        'files__uploaded_by', 'contacts',
        'blockers__reported_by', 'blockers__resolved_by',
        # tasks are serialized with TaskCardSerializer, which reads each task's
        # checklist/comments/labels for its counts — prefetch them so those
        # reads hit cache instead of N+1-ing per task.
        'tasks__assigned_to', 'tasks__checklist', 'tasks__comments', 'tasks__labels',
        'co_assignments__user', 'milestones__created_by',
    ).all()
    serializer_class = ProjectsSerializer
    permission_classes = [IsManagerOrProjectMember]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['client', 'assigned_to', 'status', 'priority', 'start_date', 'end_date']
    search_fields = ['name', 'description', 'client__name', 'assigned_to__username']
    ordering_fields = ['start_date', 'end_date', 'created_at']
    ordering = ['-created_at']

    def perform_create(self, serializer):
        project = serializer.save()
        actor = self.request.user
        _log_project_activity(project, actor, 'created', f'Project "{project.name}" created.')
        if project.assigned_to and project.assigned_to != actor:
            _notify(
                project.assigned_to,
                f'You\'ve been assigned a project: {project.name}',
                'project_assigned',
                project.name,
                f'Assigned by {actor.display_name}',
                actor,
                project.name,
                f'{settings.PORTAL_BASE_URL}/dashboard/projects/{project.id}/',
            )

    def perform_update(self, serializer):
        old_assignee = serializer.instance.assigned_to
        old_status = serializer.instance.status
        project = serializer.save()
        actor = self.request.user
        _log_project_activity(project, actor, 'updated', f'Project "{project.name}" updated.')
        url = f'{settings.PORTAL_BASE_URL}/dashboard/projects/{project.id}/'
        if project.assigned_to and project.assigned_to != old_assignee and project.assigned_to != actor:
            _notify(
                project.assigned_to,
                f'You\'ve been assigned a project: {project.name}',
                'project_assigned',
                project.name,
                f'Assigned by {actor.display_name}',
                actor,
                project.name,
                url,
            )
        if project.status != old_status:
            for member in _get_project_team(project, exclude_user=actor):
                _notify(
                    member,
                    f'Project status updated: {project.name}',
                    'project_status_changed',
                    project.name,
                    f'Status changed from {old_status} to {project.status}',
                    actor,
                    project.name,
                    url,
                )

    def perform_destroy(self, instance):
        _log_project_activity(instance, self.request.user, 'deleted', f'Project "{instance.name}" deleted.')
        instance.delete()


# ─────────────────────────────────────────────────────────────
# My Projects (role-filtered)
# ─────────────────────────────────────────────────────────────
@extend_schema(
    tags=['Projects'],
    summary='My projects',
    description=(
        'Returns projects visible to the current user. '
        'Admins and superusers see all projects. '
        'Other users see only projects where they are the primary assignee or a co-assignee.'
    ),
    parameters=[
        OpenApiParameter('status', str, description='Filter by status', required=False),
        OpenApiParameter('priority', str, description='Filter by priority', required=False),
        OpenApiParameter('search', str, description='Search in name/description', required=False),
    ],
    responses={200: ProjectListSerializer(many=True)},
)
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def my_projects(request):
    user = request.user
    qs = Projects.objects.select_related('client', 'assigned_to').prefetch_related(
        'tasks', 'blockers', 'co_assignments__user',
    )
    if not _is_manager(user):
        qs = qs.filter(
            Q(assigned_to=user) | Q(co_assignments__user=user)
        ).distinct()

    # Filters
    status_filter = request.query_params.get('status')
    if status_filter:
        qs = qs.filter(status=status_filter)
    priority_filter = request.query_params.get('priority')
    if priority_filter:
        qs = qs.filter(priority=priority_filter)
    search = request.query_params.get('search')
    if search:
        qs = qs.filter(Q(name__icontains=search) | Q(description__icontains=search))

    qs = qs.order_by('-created_at')
    serializer = ProjectListSerializer(qs, many=True)
    return Response(serializer.data)


# ─────────────────────────────────────────────────────────────
# Project Progress
# ─────────────────────────────────────────────────────────────
@extend_schema(
    tags=['Projects'],
    summary='Project task progress',
    responses={200: OpenApiResponse(description='{"total": int, "done": int, "percent": int}')},
)
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def project_progress(request, pk):
    try:
        project = Projects.objects.get(pk=pk)
    except Projects.DoesNotExist:
        return Response({'error': 'Project not found'}, status=drf_status.HTTP_404_NOT_FOUND)
    total = project.tasks.count()
    done = project.tasks.filter(status='done').count()
    in_progress = project.tasks.filter(status='in_progress').count()
    in_review = project.tasks.filter(status='in_review').count()
    todo = project.tasks.filter(status='todo').count()
    return Response({
        'total': total,
        'done': done,
        'in_progress': in_progress,
        'in_review': in_review,
        'todo': todo,
        'percent': round((done / total) * 100) if total else 0,
    })


# ─────────────────────────────────────────────────────────────
# Project Files
# ─────────────────────────────────────────────────────────────
@extend_schema_view(
    list=extend_schema(tags=['Project Files'], summary='List project files'),
    retrieve=extend_schema(tags=['Project Files'], summary='Retrieve a project file'),
    create=extend_schema(tags=['Project Files'], summary='Upload a project file'),
    update=extend_schema(tags=['Project Files'], summary='Update a project file'),
    partial_update=extend_schema(tags=['Project Files'], summary='Partially update a project file'),
    destroy=extend_schema(tags=['Project Files'], summary='Delete a project file'),
)
class ProjectFilesViewSet(FileUploadMixin, viewsets.ModelViewSet):
    queryset = ProjectFiles.objects.select_related('project', 'uploaded_by').all()
    serializer_class = ProjectFilesSerializer
    permission_classes = _PERMISSIONS
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['project', 'uploaded_by']
    search_fields = ['file_name', 'project__name']
    ordering_fields = ['uploaded_at']
    ordering = ['-uploaded_at']

    def perform_create(self, serializer):
        pf = serializer.save(uploaded_by=self.request.user)
        _log_project_activity(pf.project, self.request.user, 'file_uploaded', f'File "{pf.file_name}" uploaded.')


# ─────────────────────────────────────────────────────────────
# Project Contact Persons
# ─────────────────────────────────────────────────────────────
@extend_schema_view(
    list=extend_schema(tags=['Project Contacts'], summary='List project contact persons'),
    retrieve=extend_schema(tags=['Project Contacts'], summary='Retrieve a project contact person'),
    create=extend_schema(tags=['Project Contacts'], summary='Create a project contact person'),
    update=extend_schema(tags=['Project Contacts'], summary='Update a project contact person'),
    partial_update=extend_schema(tags=['Project Contacts'], summary='Partially update a project contact person'),
    destroy=extend_schema(tags=['Project Contacts'], summary='Delete a project contact person'),
)
class ProjectContactPersonViewSet(viewsets.ModelViewSet):
    queryset = ProjectContactPerson.objects.select_related('project').all()
    serializer_class = ProjectContactPersonSerializer
    permission_classes = _PERMISSIONS
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['project']
    search_fields = ['name', 'email', 'role', 'project__name']
    ordering_fields = ['name']
    ordering = ['name']


# ─────────────────────────────────────────────────────────────
# Project Blockers
# ─────────────────────────────────────────────────────────────
@extend_schema_view(
    list=extend_schema(tags=['Project Blockers'], summary='List project blockers'),
    retrieve=extend_schema(tags=['Project Blockers'], summary='Retrieve a project blocker'),
    create=extend_schema(tags=['Project Blockers'], summary='Create a project blocker'),
    update=extend_schema(tags=['Project Blockers'], summary='Update a project blocker'),
    partial_update=extend_schema(tags=['Project Blockers'], summary='Partially update a project blocker'),
    destroy=extend_schema(tags=['Project Blockers'], summary='Delete a project blocker'),
)
class ProjectBlockersViewSet(FileUploadMixin, viewsets.ModelViewSet):
    queryset = projectBlockers.objects.select_related('project', 'reported_by', 'resolved_by').all()
    serializer_class = ProjectBlockersSerializer
    permission_classes = _PERMISSIONS
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['project', 'resolved', 'reported_by', 'resolved_by']
    search_fields = ['description', 'project__name', 'reported_by__username']
    ordering_fields = ['created_at', 'resolved_at']
    ordering = ['-created_at']

    def perform_create(self, serializer):
        b = serializer.save(reported_by=self.request.user)
        actor = self.request.user
        _log_project_activity(b.project, actor, 'blocker_added', b.description[:100])
        url = f'{settings.PORTAL_BASE_URL}/dashboard/projects/{b.project_id}/'
        for member in _get_project_team(b.project, exclude_user=actor):
            _notify(
                member,
                f'Blocker reported on project: {b.project.name}',
                'blocker_added',
                b.description[:80],
                f'Reported on project: {b.project.name}',
                actor,
                b.project.name,
                url,
            )

    def perform_update(self, serializer):
        old_resolved = serializer.instance.resolved
        b = serializer.save()
        actor = self.request.user
        if b.resolved and not old_resolved and b.reported_by and b.reported_by != actor:
            _notify(
                b.reported_by,
                f'Blocker resolved on project: {b.project.name}',
                'blocker_resolved',
                b.description[:80],
                f'Resolved on project: {b.project.name}',
                actor,
                b.project.name,
                f'{settings.PORTAL_BASE_URL}/dashboard/projects/{b.project_id}/',
            )


# ─────────────────────────────────────────────────────────────
# Project Co-Assignments
# ─────────────────────────────────────────────────────────────
@extend_schema_view(
    list=extend_schema(tags=['Project Co-Assignments'], summary='List project co-assignments'),
    retrieve=extend_schema(tags=['Project Co-Assignments'], summary='Retrieve a co-assignment'),
    create=extend_schema(tags=['Project Co-Assignments'], summary='Co-assign a user to a project'),
    update=extend_schema(tags=['Project Co-Assignments'], summary='Update a co-assignment'),
    partial_update=extend_schema(tags=['Project Co-Assignments'], summary='Partially update a co-assignment'),
    destroy=extend_schema(tags=['Project Co-Assignments'], summary='Remove a co-assignment'),
)
class ProjectCoAssignmentViewSet(viewsets.ModelViewSet):
    queryset = ProjectCoAssignment.objects.select_related('project', 'user', 'assigned_by').all()
    serializer_class = ProjectCoAssignmentSerializer
    permission_classes = _PERMISSIONS
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['project', 'user', 'role']
    search_fields = ['user__username', 'user__full_name', 'project__name']
    ordering_fields = ['assigned_at']
    ordering = ['-assigned_at']

    def perform_create(self, serializer):
        ca = serializer.save(assigned_by=self.request.user)
        actor = self.request.user
        _log_project_activity(
            ca.project, actor, 'co_assigned',
            f'{ca.user.get_full_name() or ca.user.username} co-assigned as {ca.role}.',
        )
        if ca.user != actor:
            _notify(
                ca.user,
                f'You\'ve been added to project: {ca.project.name}',
                'co_assignment_added',
                ca.project.name,
                f'Added as {ca.role} by {actor.display_name}',
                actor,
                ca.project.name,
                f'{settings.PORTAL_BASE_URL}/dashboard/projects/{ca.project_id}/',
            )

    def perform_destroy(self, instance):
        _log_project_activity(
            instance.project, self.request.user, 'co_assignment_removed',
            f'{instance.user.get_full_name() or instance.user.username} removed from co-assignment.',
        )
        instance.delete()


# ─────────────────────────────────────────────────────────────
# Project Milestones
# ─────────────────────────────────────────────────────────────
@extend_schema_view(
    list=extend_schema(tags=['Project Milestones'], summary='List project milestones'),
    retrieve=extend_schema(tags=['Project Milestones'], summary='Retrieve a milestone'),
    create=extend_schema(tags=['Project Milestones'], summary='Create a milestone'),
    update=extend_schema(tags=['Project Milestones'], summary='Update a milestone'),
    partial_update=extend_schema(tags=['Project Milestones'], summary='Partially update a milestone'),
    destroy=extend_schema(tags=['Project Milestones'], summary='Delete a milestone'),
)
class ProjectMilestoneViewSet(viewsets.ModelViewSet):
    queryset = ProjectMilestone.objects.select_related('project', 'created_by').all()
    serializer_class = ProjectMilestoneSerializer
    permission_classes = _PERMISSIONS
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['project', 'completed']
    search_fields = ['name', 'project__name']
    ordering_fields = ['due_date', 'created_at']
    ordering = ['due_date']

    def perform_create(self, serializer):
        m = serializer.save(created_by=self.request.user)
        actor = self.request.user
        _log_project_activity(m.project, actor, 'milestone_added', f'Milestone "{m.name}" added.')
        url = f'{settings.PORTAL_BASE_URL}/dashboard/projects/{m.project_id}/'
        for member in _get_project_team(m.project, exclude_user=actor):
            _notify(
                member,
                f'New milestone added: {m.name}',
                'milestone_added',
                m.name,
                f'Added to project: {m.project.name}',
                actor,
                m.project.name,
                url,
            )

    def perform_update(self, serializer):
        old_completed = serializer.instance.completed
        m = serializer.save()
        actor = self.request.user
        if m.completed and not m.completed_at:
            m.completed_at = timezone.now()
            m.save(update_fields=['completed_at'])
        _log_project_activity(m.project, actor, 'milestone_updated', f'Milestone "{m.name}" updated.')
        if m.completed and not old_completed:
            url = f'{settings.PORTAL_BASE_URL}/dashboard/projects/{m.project_id}/'
            for member in _get_project_team(m.project, exclude_user=actor):
                _notify(
                    member,
                    f'Milestone completed: {m.name}',
                    'milestone_completed',
                    m.name,
                    f'Completed in project: {m.project.name}',
                    actor,
                    m.project.name,
                    url,
                )


# ─────────────────────────────────────────────────────────────
# Project Activity (read-only)
# ─────────────────────────────────────────────────────────────
@extend_schema_view(
    list=extend_schema(tags=['Project Activity'], summary='List project activity log'),
    retrieve=extend_schema(tags=['Project Activity'], summary='Retrieve a project activity entry'),
)
class ProjectActivityViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ProjectActivity.objects.select_related('project', 'user').all()
    serializer_class = ProjectActivitySerializer
    permission_classes = _PERMISSIONS
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ['project', 'user']
    ordering_fields = ['created_at']
    ordering = ['-created_at']


# ─────────────────────────────────────────────────────────────
# Task Labels
# ─────────────────────────────────────────────────────────────
@extend_schema_view(
    list=extend_schema(tags=['Task Labels'], summary='List task labels'),
    retrieve=extend_schema(tags=['Task Labels'], summary='Retrieve a task label'),
    create=extend_schema(tags=['Task Labels'], summary='Create a task label'),
    update=extend_schema(tags=['Task Labels'], summary='Update a task label'),
    partial_update=extend_schema(tags=['Task Labels'], summary='Partially update a task label'),
    destroy=extend_schema(tags=['Task Labels'], summary='Delete a task label'),
)
class TaskLabelViewSet(viewsets.ModelViewSet):
    queryset = TaskLabel.objects.all()
    serializer_class = TaskLabelSerializer
    permission_classes = _PERMISSIONS
    filter_backends = [SearchFilter, OrderingFilter]
    search_fields = ['name']
    ordering = ['name']

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


# ─────────────────────────────────────────────────────────────
# Tasks
# ─────────────────────────────────────────────────────────────
@extend_schema_view(
    list=extend_schema(tags=['Tasks'], summary='List all tasks'),
    retrieve=extend_schema(tags=['Tasks'], summary='Retrieve a task'),
    create=extend_schema(tags=['Tasks'], summary='Create a task'),
    update=extend_schema(tags=['Tasks'], summary='Update a task'),
    partial_update=extend_schema(tags=['Tasks'], summary='Partially update a task'),
    destroy=extend_schema(tags=['Tasks'], summary='Delete a task'),
)
class TasksViewSet(viewsets.ModelViewSet):
    queryset = Tasks.objects.select_related(
        'project', 'assigned_to', 'created_by', 'completed_by',
    ).prefetch_related(
        'files__uploaded_by', 'blockers__reported_by', 'blockers__resolved_by',
        'comments__author', 'checklist__completed_by', 'labels', 'activities__user',
    ).all()
    serializer_class = TasksSerializer
    permission_classes = [IsManagerOrTaskOwner]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['project', 'assigned_to', 'status', 'priority', 'created_by', 'due_date']
    search_fields = ['name', 'description', 'project__name', 'assigned_to__username']
    ordering_fields = ['due_date', 'created_at', 'status', 'priority']
    ordering = ['due_date', '-created_at']

    def perform_create(self, serializer):
        task = serializer.save(created_by=self.request.user)
        actor = self.request.user
        _log_task_activity(task, actor, 'created', f'Task "{task.name}" created.')
        _log_project_activity(task.project, actor, 'task_added', f'Task "{task.name}" added.')
        if task.assigned_to and task.assigned_to != actor:
            _notify(
                task.assigned_to,
                f'Task assigned to you: {task.name}',
                'task_assigned',
                task.name,
                f'Assigned in project: {task.project.name}',
                actor,
                task.project.name,
                f'{settings.PORTAL_BASE_URL}/dashboard/projects/{task.project_id}/tasks/',
            )

    def perform_update(self, serializer):
        old_status = serializer.instance.status
        old_assignee = serializer.instance.assigned_to
        task = serializer.save()
        actor = self.request.user
        url = f'{settings.PORTAL_BASE_URL}/dashboard/projects/{task.project_id}/tasks/'
        if task.status != old_status:
            _log_task_activity(
                task, actor, 'status_changed',
                f'Status changed from "{old_status}" to "{task.status}".',
            )
            if task.status == 'done':
                recipients = set()
                if task.assigned_to and task.assigned_to != actor:
                    recipients.add(task.assigned_to)
                if task.project.assigned_to and task.project.assigned_to != actor:
                    recipients.add(task.project.assigned_to)
                for r in recipients:
                    _notify(r, f'Task completed: {task.name}',
                            'task_completed', task.name,
                            f'Marked done in project: {task.project.name}',
                            actor, task.project.name, url)
            elif task.assigned_to and task.assigned_to != actor:
                _notify(
                    task.assigned_to,
                    f'Task status updated: {task.name}',
                    'task_status_changed',
                    task.name,
                    f'Status changed from {old_status} to {task.status}',
                    actor,
                    task.project.name,
                    url,
                )
        else:
            _log_task_activity(task, actor, 'updated', f'Task "{task.name}" updated.')
        if task.assigned_to and task.assigned_to != old_assignee and task.assigned_to != actor:
            _notify(
                task.assigned_to,
                f'Task assigned to you: {task.name}',
                'task_assigned',
                task.name,
                f'Assigned in project: {task.project.name}',
                actor,
                task.project.name,
                url,
            )

    def perform_destroy(self, instance):
        _log_project_activity(
            instance.project, self.request.user, 'task_deleted', f'Task "{instance.name}" deleted.',
        )
        instance.delete()

    @extend_schema(tags=['Tasks'], summary='Get Kanban board tasks for a project')
    @action(detail=False, methods=['get'], url_path='board/(?P<project_id>[0-9]+)')
    def board(self, request, project_id=None):
        """GET /api/projects/tasks/board/<project_id>/ — Kanban grouped by status"""
        qs = Tasks.objects.filter(project_id=project_id).select_related(
            'assigned_to',
        ).prefetch_related('labels', 'checklist', 'comments')
        serializer = TaskCardSerializer(qs, many=True)
        data = serializer.data
        board = {col: [] for col in ['todo', 'in_progress', 'in_review', 'done']}
        for task in data:
            col = task['status']
            if col in board:
                board[col].append(task)
        # Include project name for the board header
        try:
            project = Projects.objects.get(pk=project_id)
            board['project_name'] = project.name
        except Projects.DoesNotExist:
            pass
        return Response(board)


# ─────────────────────────────────────────────────────────────
# Task Files
# ─────────────────────────────────────────────────────────────
@extend_schema_view(
    list=extend_schema(tags=['Task Files'], summary='List task files'),
    retrieve=extend_schema(tags=['Task Files'], summary='Retrieve a task file'),
    create=extend_schema(tags=['Task Files'], summary='Upload a task file'),
    update=extend_schema(tags=['Task Files'], summary='Update a task file'),
    partial_update=extend_schema(tags=['Task Files'], summary='Partially update a task file'),
    destroy=extend_schema(tags=['Task Files'], summary='Delete a task file'),
)
class TaskFilesViewSet(FileUploadMixin, viewsets.ModelViewSet):
    queryset = TaskFiles.objects.select_related('task', 'uploaded_by').all()
    serializer_class = TaskFilesSerializer
    permission_classes = _PERMISSIONS
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['task', 'uploaded_by']
    search_fields = ['file_name', 'task__name']
    ordering_fields = ['uploaded_at']
    ordering = ['-uploaded_at']

    def perform_create(self, serializer):
        tf = serializer.save(uploaded_by=self.request.user)
        _log_task_activity(tf.task, self.request.user, 'file_uploaded', f'File "{tf.file_name}" uploaded.')


# ─────────────────────────────────────────────────────────────
# Task Blockers
# ─────────────────────────────────────────────────────────────
@extend_schema_view(
    list=extend_schema(tags=['Task Blockers'], summary='List task blockers'),
    retrieve=extend_schema(tags=['Task Blockers'], summary='Retrieve a task blocker'),
    create=extend_schema(tags=['Task Blockers'], summary='Create a task blocker'),
    update=extend_schema(tags=['Task Blockers'], summary='Update a task blocker'),
    partial_update=extend_schema(tags=['Task Blockers'], summary='Partially update a task blocker'),
    destroy=extend_schema(tags=['Task Blockers'], summary='Delete a task blocker'),
)
class TaskBlockersViewSet(FileUploadMixin, viewsets.ModelViewSet):
    queryset = TaskBlockers.objects.select_related('task', 'reported_by', 'resolved_by').all()
    serializer_class = TaskBlockersSerializer
    permission_classes = _PERMISSIONS
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['task', 'resolved', 'reported_by']
    search_fields = ['description', 'task__name']
    ordering_fields = ['created_at', 'resolved_at']
    ordering = ['-created_at']

    def perform_create(self, serializer):
        b = serializer.save(reported_by=self.request.user)
        actor = self.request.user
        _log_task_activity(b.task, actor, 'blocker_added', b.description[:100])
        if b.task.assigned_to and b.task.assigned_to != actor:
            _notify(
                b.task.assigned_to,
                f'Blocker reported on your task: {b.task.name}',
                'blocker_added',
                b.description[:80],
                f'Reported on task: {b.task.name}',
                actor,
                b.task.project.name,
                f'{settings.PORTAL_BASE_URL}/dashboard/projects/{b.task.project_id}/tasks/',
            )

    def perform_update(self, serializer):
        old_resolved = serializer.instance.resolved
        b = serializer.save()
        actor = self.request.user
        if b.resolved and not old_resolved and b.reported_by and b.reported_by != actor:
            _notify(
                b.reported_by,
                f'Blocker resolved on task: {b.task.name}',
                'blocker_resolved',
                b.description[:80],
                f'Resolved on task: {b.task.name}',
                actor,
                b.task.project.name,
                f'{settings.PORTAL_BASE_URL}/dashboard/projects/{b.task.project_id}/tasks/',
            )


# ─────────────────────────────────────────────────────────────
# Task Comments
# ─────────────────────────────────────────────────────────────
@extend_schema_view(
    list=extend_schema(tags=['Task Comments'], summary='List task comments'),
    retrieve=extend_schema(tags=['Task Comments'], summary='Retrieve a comment'),
    create=extend_schema(tags=['Task Comments'], summary='Add a comment to a task'),
    update=extend_schema(tags=['Task Comments'], summary='Update a comment'),
    partial_update=extend_schema(tags=['Task Comments'], summary='Partially update a comment'),
    destroy=extend_schema(tags=['Task Comments'], summary='Delete a comment'),
)
class TaskCommentViewSet(viewsets.ModelViewSet):
    queryset = TaskComment.objects.select_related('task', 'author').all()
    serializer_class = TaskCommentSerializer
    permission_classes = _PERMISSIONS
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ['task', 'author']
    ordering_fields = ['created_at']
    ordering = ['created_at']

    def perform_create(self, serializer):
        comment = serializer.save(author=self.request.user)
        actor = self.request.user
        _log_task_activity(comment.task, actor, 'comment_added', comment.content[:80])
        if comment.task.assigned_to and comment.task.assigned_to != actor:
            _notify(
                comment.task.assigned_to,
                f'New comment on your task: {comment.task.name}',
                'comment_added',
                comment.content[:100],
                f'Comment on task in project: {comment.task.project.name}',
                actor,
                comment.task.project.name,
                f'{settings.PORTAL_BASE_URL}/dashboard/projects/{comment.task.project_id}/tasks/',
            )

    def perform_destroy(self, instance):
        _log_task_activity(instance.task, self.request.user, 'comment_deleted', 'Comment removed.')
        instance.delete()


# ─────────────────────────────────────────────────────────────
# Task Checklist
# ─────────────────────────────────────────────────────────────
@extend_schema_view(
    list=extend_schema(tags=['Task Checklists'], summary='List checklist items for a task'),
    retrieve=extend_schema(tags=['Task Checklists'], summary='Retrieve a checklist item'),
    create=extend_schema(tags=['Task Checklists'], summary='Add a checklist item'),
    update=extend_schema(tags=['Task Checklists'], summary='Update a checklist item'),
    partial_update=extend_schema(tags=['Task Checklists'], summary='Partially update a checklist item'),
    destroy=extend_schema(tags=['Task Checklists'], summary='Delete a checklist item'),
)
class TaskChecklistViewSet(viewsets.ModelViewSet):
    queryset = TaskChecklist.objects.select_related('task', 'completed_by').all()
    serializer_class = TaskChecklistSerializer
    permission_classes = _PERMISSIONS
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ['task', 'completed']
    ordering_fields = ['order', 'id']
    ordering = ['order', 'id']

    def perform_update(self, serializer):
        item = serializer.save()
        if item.completed and not item.completed_at:
            item.completed_at = timezone.now()
            item.completed_by = self.request.user
            item.save(update_fields=['completed_at', 'completed_by'])
        elif not item.completed:
            item.completed_at = None
            item.completed_by = None
            item.save(update_fields=['completed_at', 'completed_by'])
        _log_task_activity(
            item.task, self.request.user,
            'checklist_checked' if item.completed else 'checklist_unchecked',
            f'"{item.title}" marked {"done" if item.completed else "incomplete"}.',
        )


# ─────────────────────────────────────────────────────────────
# Task Activity (read-only)
# ─────────────────────────────────────────────────────────────
@extend_schema_view(
    list=extend_schema(tags=['Task Activity'], summary='List task activity log'),
    retrieve=extend_schema(tags=['Task Activity'], summary='Retrieve a task activity entry'),
)
class TaskActivityViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = TaskActivity.objects.select_related('task', 'user').all()
    serializer_class = TaskActivitySerializer
    permission_classes = _PERMISSIONS
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ['task', 'user']
    ordering_fields = ['created_at']
    ordering = ['-created_at']


# ─────────────────────────────────────────────────────────────
# Dashboard Stats
# ─────────────────────────────────────────────────────────────
@extend_schema(tags=['Projects'], summary='Dashboard stats')
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def dashboard_stats(request):
    total_projects = Projects.objects.count()
    active_projects = Projects.objects.filter(status='active').count()
    total_tasks = Tasks.objects.count()
    done_tasks = Tasks.objects.filter(status='done').count()
    return Response({
        'total_projects': total_projects,
        'active_projects': active_projects,
        'total_tasks': total_tasks,
        'done_tasks': done_tasks,
        'pending_tasks': total_tasks - done_tasks,
    })


@extend_schema(
    tags=['Projects'],
    summary='Admin dashboard — full operational overview',
    description='Aggregate counts (projects/clients/tasks/users/blockers), staff workload, and recent records. Managers only.',
    responses={200: OpenApiResponse(description='Admin dashboard payload')},
)
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_dashboard(request):
    if not _is_manager(request.user):
        return Response({'detail': 'Forbidden.'}, status=drf_status.HTTP_403_FORBIDDEN)

    today = timezone.now().date()
    P, T, C, U = Projects.objects, Tasks.objects, Clients.objects, User.objects
    total_tasks = T.count()
    done_tasks = T.filter(status='done').count()

    # Per-user open-task and project counts in two grouped queries (avoids N+1).
    open_tasks_by_user = dict(
        T.exclude(status='done').exclude(assigned_to=None)
         .values_list('assigned_to').annotate(c=Count('id'))
    )
    projects_by_user = dict(
        P.exclude(assigned_to=None).values_list('assigned_to').annotate(c=Count('id'))
    )

    workload = [
        {
            'id': u.id,
            'name': u.display_name,
            'role': u.role,
            'tasks': open_tasks_by_user.get(u.id, 0),
            'projects': projects_by_user.get(u.id, 0),
        }
        for u in U.filter(is_active=True).order_by('-is_superuser', 'role', 'full_name')
    ]

    def proj_row(p):
        return {
            'id': p.id, 'name': p.name, 'status': p.status, 'priority': p.priority,
            'client_name': p.client.name if p.client else None,
            'assigned_to_name': p.assigned_to.display_name if p.assigned_to else None,
            'start_date': p.start_date, 'end_date': p.end_date,
        }

    def task_row(t):
        return {
            'id': t.id, 'name': t.name, 'status': t.status, 'due_date': t.due_date,
            'project_id': t.project_id, 'project_name': t.project.name if t.project else None,
            'assigned_to_name': t.assigned_to.display_name if t.assigned_to else None,
        }

    def client_row(c):
        return {
            'id': c.id, 'name': c.name, 'email': c.email, 'company_name': c.company_name,
            'is_active': c.is_active, 'created_at': c.created_at,
        }

    return Response({
        'projects': {
            'total': P.count(),
            'active': P.filter(status='active').count(),
            'completed': P.filter(status='completed').count(),
            'on_hold': P.filter(status='on_hold').count(),
            'cancelled': P.filter(status='cancelled').count(),
            'overdue': P.filter(status='active', end_date__lt=today).count(),
        },
        'clients': {'total': C.count(), 'active': C.filter(is_active=True).count()},
        'tasks': {
            'total': total_tasks, 'done': done_tasks, 'pending': total_tasks - done_tasks,
            'overdue': T.exclude(status='done').filter(due_date__lt=today).count(),
        },
        'users': {
            'total': U.count(),
            'active': U.filter(is_active=True).count(),
            'inactive': U.filter(is_active=False).count(),
            'superusers': U.filter(Q(role='superuser') | Q(is_superuser=True)).count(),
            'admins': U.filter(role='admin').count(),
        },
        'blockers': {
            'project_open': projectBlockers.objects.filter(resolved=False).count(),
            'task_open': TaskBlockers.objects.filter(resolved=False).count(),
        },
        'staff_workload': workload,
        'recent_projects': [proj_row(p) for p in P.select_related('client', 'assigned_to').order_by('-created_at')[:5]],
        'recent_tasks': [task_row(t) for t in T.select_related('project', 'assigned_to').order_by('-created_at')[:5]],
        'recent_clients': [client_row(c) for c in C.order_by('-created_at')[:5]],
    })


# ─────────────────────────────────────────────────────────────
# Personalized Dashboard Data
# ─────────────────────────────────────────────────────────────
@extend_schema(
    tags=['Projects'],
    summary='Personalized dashboard data for the current user',
    description=(
        'Returns stat counts, almost-due tasks, high-priority tasks, '
        'overdue tasks, upcoming milestones, active project blockers, '
        'and recent project activity — all scoped to the current user.'
    ),
    responses={200: OpenApiResponse(description='Dashboard payload')},
)
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def my_dashboard(request):
    user = request.user
    today = timezone.now().date()
    in_7_days = today + timezone.timedelta(days=7)

    # ── My projects (primary + co-assigned)
    my_projects_qs = Projects.objects.filter(
        Q(assigned_to=user) | Q(co_assignments__user=user)
    ).distinct()

    # ── Stat counts
    my_open_tasks = Tasks.objects.filter(
        assigned_to=user
    ).exclude(status='done').count()

    my_overdue = Tasks.objects.filter(
        assigned_to=user, due_date__lt=today
    ).exclude(status='done').count()

    my_high_priority = Tasks.objects.filter(
        assigned_to=user, priority__in=['high', 'critical']
    ).exclude(status='done').count()

    my_active_projects = my_projects_qs.filter(status='active').count()

    # ── Almost-due tasks (due within 7 days, not done)
    almost_due_qs = Tasks.objects.filter(
        assigned_to=user,
        due_date__gte=today,
        due_date__lte=in_7_days,
    ).exclude(status='done').select_related('project').order_by('due_date')[:10]

    # ── Overdue tasks list
    overdue_qs = Tasks.objects.filter(
        assigned_to=user,
        due_date__lt=today,
    ).exclude(status='done').select_related('project').order_by('due_date')[:10]

    # ── High/critical open tasks
    high_priority_qs = Tasks.objects.filter(
        assigned_to=user,
        priority__in=['high', 'critical'],
    ).exclude(status='done').select_related('project').order_by('due_date', '-created_at')[:10]

    # ── My open tasks (general list)
    my_tasks_qs = Tasks.objects.filter(
        assigned_to=user,
    ).exclude(status='done').select_related('project').order_by('due_date', '-created_at')[:15]

    # ── Upcoming milestones (any project I'm on, incomplete, next 14 days)
    upcoming_milestones_qs = ProjectMilestone.objects.filter(
        project__in=my_projects_qs,
        completed=False,
        due_date__gte=today,
        due_date__lte=today + timezone.timedelta(days=14),
    ).select_related('project').order_by('due_date')[:8]

    # ── Active blockers (unresolved, my projects)
    active_blockers_qs = projectBlockers.objects.filter(
        project__in=my_projects_qs,
        resolved=False,
    ).select_related('project', 'reported_by').order_by('-created_at')[:6]

    # ── Recent activity on my projects
    recent_activity_qs = ProjectActivity.objects.filter(
        project__in=my_projects_qs,
    ).select_related('project', 'user').order_by('-created_at')[:10]

    # ── My builds (assigned to me, not yet delivered). Lazy import to avoid a
    #    circular import between the projects and builds apps at module load.
    from builds.models import Build, BuildStatus
    my_builds_qs = Build.objects.filter(assignee=user).select_related('client').order_by('-updated_at')
    my_open_builds = my_builds_qs.exclude(status=BuildStatus.DELIVERED).count()
    my_builds_list = list(my_builds_qs[:10])

    def fmt_build(b):
        return {
            'id': b.id,
            'title': b.title,
            'status': b.status,
            'client_name': b.client.name if b.client_id else '',
            'updated_at': b.updated_at,
        }

    def fmt_task(t):
        return {
            'id': t.id,
            'name': t.name,
            'status': t.status,
            'priority': t.priority,
            'due_date': t.due_date,
            'project_id': t.project_id,
            'project_name': t.project.name,
        }

    def fmt_milestone(m):
        return {
            'id': m.id,
            'name': m.name,
            'due_date': m.due_date,
            'project_id': m.project_id,
            'project_name': m.project.name,
        }

    def fmt_blocker(b):
        return {
            'id': b.id,
            'description': b.description[:120],
            'project_id': b.project_id,
            'project_name': b.project.name,
            'reported_by': b.reported_by.display_name if b.reported_by else None,
            'created_at': b.created_at,
        }

    def fmt_activity(a):
        return {
            'id': a.id,
            'action': a.action,
            'detail': a.detail[:100],
            'project_name': a.project.name,
            'project_id': a.project_id,
            'user_name': a.user.display_name if a.user else None,
            'user_initials': (a.user.display_name[:2].upper() if a.user else '??'),
            'created_at': a.created_at,
        }

    return Response({
        'stats': {
            'my_active_projects': my_active_projects,
            'my_open_tasks': my_open_tasks,
            'my_overdue_tasks': my_overdue,
            'my_high_priority_tasks': my_high_priority,
            'my_open_builds': my_open_builds,
        },
        'my_builds': [fmt_build(b) for b in my_builds_list],
        'almost_due_tasks': [fmt_task(t) for t in almost_due_qs],
        'overdue_tasks': [fmt_task(t) for t in overdue_qs],
        'high_priority_tasks': [fmt_task(t) for t in high_priority_qs],
        'my_tasks': [fmt_task(t) for t in my_tasks_qs],
        'upcoming_milestones': [fmt_milestone(m) for m in upcoming_milestones_qs],
        'active_blockers': [fmt_blocker(b) for b in active_blockers_qs],
        'recent_activity': [fmt_activity(a) for a in recent_activity_qs],
    })
