from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field, extend_schema_serializer

from .models import (
    Build, ContactSource, PipelineStage, ManualAction, Task, TaskDependency,
    Document, MeetingNote, Comment, Activity, ChangeRequest, ApprovalRecord,
    BuildMemorySnapshot, ClientPortalFeedback, Notification, NotificationPreference,
    AiApiKey, TeamInvite, StageTransition, Workflow, CustomField, TagDefinition,
    PreLaunchItem, VisionGap, Calendar, Integration, BuildKnowledge,
)

_NULL_STR = serializers.CharField(allow_null=True)


def _user_name(user):
    if not user:
        return None
    return user.get_full_name() or user.username


def _user_initials(user):
    name = _user_name(user)
    if not name:
        return None
    parts = name.split()
    return (parts[0][0] + parts[-1][0]).upper() if len(parts) > 1 else name[:2].upper()


# ─── Build Library (knowledge the AI learns from) ─────────────────────────────
class BuildKnowledgeSerializer(serializers.ModelSerializer):
    uploaded_by_name = serializers.SerializerMethodField()
    client_name = serializers.SerializerMethodField()
    text_chars = serializers.SerializerMethodField()

    class Meta:
        model = BuildKnowledge
        # raw_text is intentionally NOT exposed (can be large); text_chars signals presence.
        fields = [
            "id", "title", "client", "client_name", "build", "filename", "file_url",
            "summary", "use_for_ai", "uploaded_by", "uploaded_by_name", "created_at", "text_chars",
        ]
        read_only_fields = ["uploaded_by", "file_url", "filename"]

    @extend_schema_field(_NULL_STR)
    def get_uploaded_by_name(self, obj):
        return _user_name(obj.uploaded_by)

    @extend_schema_field(_NULL_STR)
    def get_client_name(self, obj):
        return obj.client.name if obj.client else None

    @extend_schema_field(serializers.IntegerField())
    def get_text_chars(self, obj):
        return len(obj.raw_text or "")


# ─── Sub-resources ────────────────────────────────────────────────────────────
class ContactSourceSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContactSource
        fields = "__all__"


class ManualActionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ManualAction
        fields = "__all__"


class PipelineStageSerializer(serializers.ModelSerializer):
    manual_actions = ManualActionSerializer(many=True, read_only=True)

    class Meta:
        model = PipelineStage
        fields = "__all__"


class CalendarSerializer(serializers.ModelSerializer):
    class Meta:
        model = Calendar
        fields = "__all__"


class IntegrationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Integration
        fields = "__all__"


class StageTransitionSerializer(serializers.ModelSerializer):
    class Meta:
        model = StageTransition
        fields = "__all__"


class WorkflowSerializer(serializers.ModelSerializer):
    class Meta:
        model = Workflow
        fields = "__all__"


class CustomFieldSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomField
        fields = "__all__"


class TagDefinitionSerializer(serializers.ModelSerializer):
    class Meta:
        model = TagDefinition
        fields = "__all__"


class PreLaunchItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = PreLaunchItem
        fields = "__all__"


class VisionGapSerializer(serializers.ModelSerializer):
    resolved_by_name = serializers.SerializerMethodField()

    class Meta:
        model = VisionGap
        fields = "__all__"
        read_only_fields = ["created_by_ai", "resolved_by"]

    @extend_schema_field(_NULL_STR)
    def get_resolved_by_name(self, obj):
        return _user_name(obj.resolved_by)


class DocumentSerializer(serializers.ModelSerializer):
    uploader_name = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = "__all__"

    @extend_schema_field(_NULL_STR)
    def get_uploader_name(self, obj):
        return _user_name(obj.uploader)


class MeetingNoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = MeetingNote
        fields = "__all__"


class CommentSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()
    author_initials = serializers.SerializerMethodField()

    class Meta:
        model = Comment
        fields = "__all__"
        read_only_fields = ["author"]

    @extend_schema_field(_NULL_STR)
    def get_author_name(self, obj):
        return _user_name(obj.author)

    @extend_schema_field(_NULL_STR)
    def get_author_initials(self, obj):
        return _user_initials(obj.author)


class ActivitySerializer(serializers.ModelSerializer):
    class Meta:
        model = Activity
        fields = "__all__"


class ChangeRequestSerializer(serializers.ModelSerializer):
    owner_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ChangeRequest
        fields = "__all__"
        read_only_fields = ["created_by"]

    @extend_schema_field(_NULL_STR)
    def get_owner_name(self, obj):
        return _user_name(obj.owner)

    @extend_schema_field(_NULL_STR)
    def get_created_by_name(self, obj):
        return _user_name(obj.created_by)


class ApprovalRecordSerializer(serializers.ModelSerializer):
    approver_name = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalRecord
        fields = "__all__"
        read_only_fields = ["approver"]

    @extend_schema_field(_NULL_STR)
    def get_approver_name(self, obj):
        return _user_name(obj.approver)


class BuildMemorySnapshotSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = BuildMemorySnapshot
        fields = "__all__"

    @extend_schema_field(_NULL_STR)
    def get_created_by_name(self, obj):
        return _user_name(obj.created_by)


class ClientPortalFeedbackSerializer(serializers.ModelSerializer):
    class Meta:
        model = ClientPortalFeedback
        fields = "__all__"


class TaskDependencySerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskDependency
        fields = "__all__"


# ─── Tasks ────────────────────────────────────────────────────────────────────
@extend_schema_serializer(component_name="BuildTaskCard")
class TaskCardSerializer(serializers.ModelSerializer):
    assignee_name = serializers.SerializerMethodField()
    assignee_initials = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = [
            "id", "title", "description", "type", "status", "ai_generated",
            "progress_note", "build", "assignee", "assignee_name", "assignee_initials",
            "due_date", "created_at", "updated_at",
        ]

    @extend_schema_field(_NULL_STR)
    def get_assignee_name(self, obj):
        return _user_name(obj.assignee)

    @extend_schema_field(_NULL_STR)
    def get_assignee_initials(self, obj):
        return _user_initials(obj.assignee)


class TaskSerializer(TaskCardSerializer):
    documents = DocumentSerializer(many=True, read_only=True)
    comments = CommentSerializer(many=True, read_only=True)

    class Meta(TaskCardSerializer.Meta):
        fields = TaskCardSerializer.Meta.fields + ["documents", "comments"]


# ─── Builds ───────────────────────────────────────────────────────────────────
class BuildListSerializer(serializers.ModelSerializer):
    creator_name = serializers.SerializerMethodField()
    assignee_name = serializers.SerializerMethodField()
    client_name = serializers.SerializerMethodField()

    class Meta:
        model = Build
        fields = [
            "id", "title", "status", "goals", "integrations", "client", "client_name",
            "creator", "creator_name", "assignee", "assignee_name", "due_date",
            "client_portal_enabled", "client_portal_token", "created_at", "updated_at",
        ]
        read_only_fields = ["creator", "client_portal_token"]

    @extend_schema_field(_NULL_STR)
    def get_creator_name(self, obj):
        return _user_name(obj.creator)

    @extend_schema_field(_NULL_STR)
    def get_assignee_name(self, obj):
        return _user_name(obj.assignee)

    @extend_schema_field(_NULL_STR)
    def get_client_name(self, obj):
        return obj.client.name if obj.client else None


class BuildSerializer(BuildListSerializer):
    contact_sources = ContactSourceSerializer(many=True, read_only=True)
    calendars = CalendarSerializer(many=True, read_only=True)
    external_integrations = IntegrationSerializer(many=True, read_only=True)
    stages = PipelineStageSerializer(many=True, read_only=True)
    transitions = StageTransitionSerializer(many=True, read_only=True)
    workflows = WorkflowSerializer(many=True, read_only=True)
    custom_fields = CustomFieldSerializer(many=True, read_only=True)
    tags = TagDefinitionSerializer(many=True, read_only=True)
    pre_launch_items = PreLaunchItemSerializer(many=True, read_only=True)
    gaps = VisionGapSerializer(many=True, read_only=True)
    tasks = TaskCardSerializer(many=True, read_only=True)
    documents = DocumentSerializer(many=True, read_only=True)
    comments = CommentSerializer(many=True, read_only=True)
    change_requests = ChangeRequestSerializer(many=True, read_only=True)
    approvals = ApprovalRecordSerializer(many=True, read_only=True)
    memory_snapshots = BuildMemorySnapshotSerializer(many=True, read_only=True)
    activities = ActivitySerializer(many=True, read_only=True)

    class Meta(BuildListSerializer.Meta):
        fields = BuildListSerializer.Meta.fields + [
            "overview", "one_line_summary", "maintenance_notes",
            "contact_sources", "calendars", "external_integrations", "stages", "transitions",
            "workflows", "custom_fields", "tags", "pre_launch_items", "gaps", "tasks",
            "documents", "comments", "change_requests", "approvals", "memory_snapshots", "activities",
        ]


# ─── Notifications / keys / invites ───────────────────────────────────────────
class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = "__all__"
        read_only_fields = ["user", "created_at"]


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationPreference
        fields = "__all__"
        read_only_fields = ["user"]


class AiApiKeySerializer(serializers.ModelSerializer):
    """Never exposes the encrypted key material; accepts a write-only `api_key`."""
    api_key = serializers.CharField(write_only=True, required=False)

    class Meta:
        model = AiApiKey
        fields = [
            "id", "provider", "label", "key_preview", "active",
            "created_by", "updated_by", "created_at", "updated_at", "api_key",
        ]
        read_only_fields = ["key_preview", "created_by", "updated_by"]


class TeamInviteSerializer(serializers.ModelSerializer):
    class Meta:
        model = TeamInvite
        fields = ["id", "email", "name", "role", "accepted_at", "expires_at", "invited_by", "created_at"]
        read_only_fields = ["invited_by", "accepted_at", "expires_at"]
