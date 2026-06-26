from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field
from .models import (
    Clients, Projects, ProjectFiles, ProjectContactPerson, projectBlockers,
    ProjectCoAssignment, ProjectMilestone, ProjectActivity,
    Tasks, TaskFiles, TaskBlockers, TaskLabel, TaskComment, TaskChecklist, TaskActivity,
)


# ─────────────────────────────────────────────────────────────
# Clients
# ─────────────────────────────────────────────────────────────
class ClientsSerializer(serializers.ModelSerializer):
    class Meta:
        model = Clients
        fields = '__all__'


# ─────────────────────────────────────────────────────────────
# Project Files
# ─────────────────────────────────────────────────────────────
class ProjectFilesSerializer(serializers.ModelSerializer):
    uploaded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ProjectFiles
        fields = '__all__'

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_uploaded_by_name(self, obj):
        return obj.uploaded_by.get_full_name() or obj.uploaded_by.username if obj.uploaded_by else None


# ─────────────────────────────────────────────────────────────
# Project Contact Persons
# ─────────────────────────────────────────────────────────────
class ProjectContactPersonSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectContactPerson
        fields = '__all__'


# ─────────────────────────────────────────────────────────────
# Project Blockers
# ─────────────────────────────────────────────────────────────
class ProjectBlockersSerializer(serializers.ModelSerializer):
    reported_by_name = serializers.SerializerMethodField()
    resolved_by_name = serializers.SerializerMethodField()
    project_name = serializers.SerializerMethodField()

    class Meta:
        model = projectBlockers
        fields = '__all__'

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_reported_by_name(self, obj):
        return obj.reported_by.get_full_name() or obj.reported_by.username if obj.reported_by else None

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_resolved_by_name(self, obj):
        return obj.resolved_by.get_full_name() or obj.resolved_by.username if obj.resolved_by else None

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_project_name(self, obj):
        return obj.project.name if obj.project else None


# ─────────────────────────────────────────────────────────────
# Project Co-Assignments
# ─────────────────────────────────────────────────────────────
class ProjectCoAssignmentSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    user_initials = serializers.SerializerMethodField()
    assigned_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ProjectCoAssignment
        fields = '__all__'

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_user_name(self, obj):
        return obj.user.get_full_name() or obj.user.username if obj.user else None

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_user_initials(self, obj):
        if not obj.user:
            return None
        name = obj.user.get_full_name() or obj.user.username
        parts = name.split()
        return (parts[0][0] + parts[-1][0]).upper() if len(parts) > 1 else name[:2].upper()

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_assigned_by_name(self, obj):
        return obj.assigned_by.get_full_name() or obj.assigned_by.username if obj.assigned_by else None


# ─────────────────────────────────────────────────────────────
# Project Milestones
# ─────────────────────────────────────────────────────────────
class ProjectMilestoneSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ProjectMilestone
        fields = '__all__'

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.username if obj.created_by else None


# ─────────────────────────────────────────────────────────────
# Project Activity
# ─────────────────────────────────────────────────────────────
class ProjectActivitySerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    user_initials = serializers.SerializerMethodField()

    class Meta:
        model = ProjectActivity
        fields = '__all__'

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_user_name(self, obj):
        return obj.user.get_full_name() or obj.user.username if obj.user else None

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_user_initials(self, obj):
        if not obj.user:
            return None
        name = obj.user.get_full_name() or obj.user.username
        parts = name.split()
        return (parts[0][0] + parts[-1][0]).upper() if len(parts) > 1 else name[:2].upper()


# ─────────────────────────────────────────────────────────────
# Task Labels
# ─────────────────────────────────────────────────────────────
class TaskLabelSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskLabel
        fields = '__all__'


# ─────────────────────────────────────────────────────────────
# Task Files
# ─────────────────────────────────────────────────────────────
class TaskFilesSerializer(serializers.ModelSerializer):
    uploaded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = TaskFiles
        fields = '__all__'

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_uploaded_by_name(self, obj):
        return obj.uploaded_by.get_full_name() or obj.uploaded_by.username if obj.uploaded_by else None


# ─────────────────────────────────────────────────────────────
# Task Blockers
# ─────────────────────────────────────────────────────────────
class TaskBlockersSerializer(serializers.ModelSerializer):
    reported_by_name = serializers.SerializerMethodField()
    resolved_by_name = serializers.SerializerMethodField()
    task_name = serializers.SerializerMethodField()
    project_name = serializers.SerializerMethodField()

    class Meta:
        model = TaskBlockers
        fields = '__all__'

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_reported_by_name(self, obj):
        return obj.reported_by.get_full_name() or obj.reported_by.username if obj.reported_by else None

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_resolved_by_name(self, obj):
        return obj.resolved_by.get_full_name() or obj.resolved_by.username if obj.resolved_by else None

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_task_name(self, obj):
        return obj.task.name if obj.task else None

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_project_name(self, obj):
        return obj.task.project.name if obj.task and obj.task.project else None


# ─────────────────────────────────────────────────────────────
# Task Comments
# ─────────────────────────────────────────────────────────────
class TaskCommentSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()
    author_initials = serializers.SerializerMethodField()

    class Meta:
        model = TaskComment
        fields = '__all__'
        read_only_fields = ['author', 'created_at', 'updated_at']

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_author_name(self, obj):
        return obj.author.get_full_name() or obj.author.username if obj.author else None

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_author_initials(self, obj):
        if not obj.author:
            return None
        name = obj.author.get_full_name() or obj.author.username
        parts = name.split()
        return (parts[0][0] + parts[-1][0]).upper() if len(parts) > 1 else name[:2].upper()


# ─────────────────────────────────────────────────────────────
# Task Checklist
# ─────────────────────────────────────────────────────────────
class TaskChecklistSerializer(serializers.ModelSerializer):
    completed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = TaskChecklist
        fields = '__all__'

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_completed_by_name(self, obj):
        return obj.completed_by.get_full_name() or obj.completed_by.username if obj.completed_by else None


# ─────────────────────────────────────────────────────────────
# Task Activity
# ─────────────────────────────────────────────────────────────
class TaskActivitySerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    user_initials = serializers.SerializerMethodField()

    class Meta:
        model = TaskActivity
        fields = '__all__'

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_user_name(self, obj):
        return obj.user.get_full_name() or obj.user.username if obj.user else None

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_user_initials(self, obj):
        if not obj.user:
            return None
        name = obj.user.get_full_name() or obj.user.username
        parts = name.split()
        return (parts[0][0] + parts[-1][0]).upper() if len(parts) > 1 else name[:2].upper()


# ─────────────────────────────────────────────────────────────
# Tasks (full — includes nested data)
# ─────────────────────────────────────────────────────────────
class TasksSerializer(serializers.ModelSerializer):
    assigned_to_name = serializers.SerializerMethodField()
    assigned_to_initials = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    completed = serializers.SerializerMethodField()
    files = TaskFilesSerializer(many=True, read_only=True)
    blockers = TaskBlockersSerializer(many=True, read_only=True)
    comments = TaskCommentSerializer(many=True, read_only=True)
    checklist = TaskChecklistSerializer(many=True, read_only=True)
    labels = TaskLabelSerializer(many=True, read_only=True)
    label_ids = serializers.PrimaryKeyRelatedField(
        many=True, queryset=TaskLabel.objects.all(), source='labels', write_only=True, required=False,
    )
    checklist_total = serializers.SerializerMethodField()
    checklist_done = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()

    class Meta:
        model = Tasks
        fields = '__all__'

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_assigned_to_name(self, obj):
        return obj.assigned_to.get_full_name() or obj.assigned_to.username if obj.assigned_to else None

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_assigned_to_initials(self, obj):
        if not obj.assigned_to:
            return None
        name = obj.assigned_to.get_full_name() or obj.assigned_to.username
        parts = name.split()
        return (parts[0][0] + parts[-1][0]).upper() if len(parts) > 1 else name[:2].upper()

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.username if obj.created_by else None

    @extend_schema_field(serializers.BooleanField())
    def get_completed(self, obj):
        return obj.completed

    @extend_schema_field(serializers.IntegerField())
    def get_checklist_total(self, obj):
        # Count over the prefetched list (len of .all()) instead of .count(),
        # which would issue a fresh COUNT query per task and defeat the prefetch.
        return len(obj.checklist.all())

    @extend_schema_field(serializers.IntegerField())
    def get_checklist_done(self, obj):
        return sum(1 for c in obj.checklist.all() if c.completed)

    @extend_schema_field(serializers.IntegerField())
    def get_comment_count(self, obj):
        return len(obj.comments.all())


# Lightweight serializer for Kanban board cards (avoids heavy nested queries)
class TaskCardSerializer(serializers.ModelSerializer):
    assigned_to_name = serializers.SerializerMethodField()
    assigned_to_initials = serializers.SerializerMethodField()
    labels = TaskLabelSerializer(many=True, read_only=True)
    completed = serializers.SerializerMethodField()
    checklist_total = serializers.SerializerMethodField()
    checklist_done = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()

    class Meta:
        model = Tasks
        fields = [
            'id', 'name', 'status', 'priority', 'assigned_to', 'assigned_to_name',
            'assigned_to_initials', 'labels', 'due_date', 'estimated_hours', 'actual_hours',
            'checklist_total', 'checklist_done', 'comment_count', 'completed', 'created_at',
        ]

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_assigned_to_name(self, obj):
        return obj.assigned_to.get_full_name() or obj.assigned_to.username if obj.assigned_to else None

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_assigned_to_initials(self, obj):
        if not obj.assigned_to:
            return None
        name = obj.assigned_to.get_full_name() or obj.assigned_to.username
        parts = name.split()
        return (parts[0][0] + parts[-1][0]).upper() if len(parts) > 1 else name[:2].upper()

    @extend_schema_field(serializers.BooleanField())
    def get_completed(self, obj):
        return obj.completed

    @extend_schema_field(serializers.IntegerField())
    def get_checklist_total(self, obj):
        # See TasksSerializer: iterate the prefetched relation, never .count().
        return len(obj.checklist.all())

    @extend_schema_field(serializers.IntegerField())
    def get_checklist_done(self, obj):
        return sum(1 for c in obj.checklist.all() if c.completed)

    @extend_schema_field(serializers.IntegerField())
    def get_comment_count(self, obj):
        return len(obj.comments.all())


# ─────────────────────────────────────────────────────────────
# Projects
# ─────────────────────────────────────────────────────────────
class ProjectsSerializer(serializers.ModelSerializer):
    assigned_to_name = serializers.SerializerMethodField()
    assigned_to_initials = serializers.SerializerMethodField()
    client_name = serializers.SerializerMethodField()
    files = ProjectFilesSerializer(many=True, read_only=True)
    contacts = ProjectContactPersonSerializer(many=True, read_only=True)
    blockers = ProjectBlockersSerializer(many=True, read_only=True)
    tasks = TaskCardSerializer(many=True, read_only=True)
    co_assignments = ProjectCoAssignmentSerializer(many=True, read_only=True)
    milestones = ProjectMilestoneSerializer(many=True, read_only=True)
    progress_percent = serializers.SerializerMethodField()

    class Meta:
        model = Projects
        fields = '__all__'

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_assigned_to_name(self, obj):
        return obj.assigned_to.get_full_name() or obj.assigned_to.username if obj.assigned_to else None

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_assigned_to_initials(self, obj):
        if not obj.assigned_to:
            return None
        name = obj.assigned_to.get_full_name() or obj.assigned_to.username
        parts = name.split()
        return (parts[0][0] + parts[-1][0]).upper() if len(parts) > 1 else name[:2].upper()

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_client_name(self, obj):
        return obj.client.name if obj.client else None

    @extend_schema_field(serializers.IntegerField())
    def get_progress_percent(self, obj):
        # Tasks are already prefetched + fully serialized below, so count them in
        # Python rather than firing two extra COUNT queries per project.
        tasks = obj.tasks.all()
        total = len(tasks)
        if total == 0:
            return 0
        done = sum(1 for t in tasks if t.status == 'done')
        return round((done / total) * 100)


# Lightweight project list serializer (no heavy nesting)
class ProjectListSerializer(serializers.ModelSerializer):
    assigned_to_name = serializers.SerializerMethodField()
    assigned_to_initials = serializers.SerializerMethodField()
    client_name = serializers.SerializerMethodField()
    co_assignments = ProjectCoAssignmentSerializer(many=True, read_only=True)
    progress_percent = serializers.SerializerMethodField()
    task_total = serializers.SerializerMethodField()
    task_done = serializers.SerializerMethodField()
    open_blockers = serializers.SerializerMethodField()

    class Meta:
        model = Projects
        fields = [
            'id', 'name', 'client', 'client_name', 'status', 'priority', 'budget',
            'start_date', 'end_date', 'created_at', 'assigned_to', 'assigned_to_name',
            'assigned_to_initials', 'co_assignments', 'progress_percent',
            'task_total', 'task_done', 'open_blockers',
        ]

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_assigned_to_name(self, obj):
        return obj.assigned_to.get_full_name() or obj.assigned_to.username if obj.assigned_to else None

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_assigned_to_initials(self, obj):
        if not obj.assigned_to:
            return None
        name = obj.assigned_to.get_full_name() or obj.assigned_to.username
        parts = name.split()
        return (parts[0][0] + parts[-1][0]).upper() if len(parts) > 1 else name[:2].upper()

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_client_name(self, obj):
        return obj.client.name if obj.client else None

    # All four counts read from the `tasks` / `blockers` relations that the
    # my_projects view prefetches. Using len()/sum() over the cached .all()
    # reuses that prefetch; the previous .count()/.filter() calls each issued a
    # fresh query per project (≈5 × N), making the prefetch dead weight.
    @extend_schema_field(serializers.IntegerField())
    def get_progress_percent(self, obj):
        tasks = obj.tasks.all()
        total = len(tasks)
        if total == 0:
            return 0
        done = sum(1 for t in tasks if t.status == 'done')
        return round((done / total) * 100)

    @extend_schema_field(serializers.IntegerField())
    def get_task_total(self, obj):
        return len(obj.tasks.all())

    @extend_schema_field(serializers.IntegerField())
    def get_task_done(self, obj):
        return sum(1 for t in obj.tasks.all() if t.status == 'done')

    @extend_schema_field(serializers.IntegerField())
    def get_open_blockers(self, obj):
        return sum(1 for b in obj.blockers.all() if not b.resolved)
