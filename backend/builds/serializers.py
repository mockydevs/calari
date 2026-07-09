from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field, extend_schema_serializer

from .models import (
    Build, Task, TaskDependency,
    Document, MeetingNote, Comment, Activity, ChangeRequest, ApprovalRecord,
    BuildMemorySnapshot, ClientPortalFeedback, Notification, NotificationPreference,
    AiApiKey, TeamInvite, BuildKnowledge, AiConfig,
    BuildSectionReview, MeetingActionItem, ProgressReport,
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


class AiConfigSerializer(serializers.ModelSerializer):
    # Write-only: submitting a non-blank value replaces the stored (encrypted) GHL MCP
    # token; blank/omitted leaves it unchanged (the secret is never re-shown — only
    # ghl_mcp_token_preview is readable). Clearing ghl_mcp_url disables the feature.
    ghl_mcp_token = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = AiConfig
        fields = [
            "provider", "model", "blueprint_model", "multi_pass",
            "ghl_mcp_url", "ghl_mcp_model", "ghl_mcp_token", "ghl_mcp_token_preview",
            "updated_at",
        ]
        read_only_fields = ["ghl_mcp_token_preview", "updated_at"]

    def update(self, instance, validated_data):
        token = (validated_data.pop("ghl_mcp_token", "") or "").strip()
        if token:
            from .services import encrypt_api_key
            instance.ghl_mcp_token_encrypted, instance.ghl_mcp_token_preview = encrypt_api_key(token)
        return super().update(instance, validated_data)


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
            "niche", "build_type", "ghl_sections", "integrations", "quality",
            "auto_generated", "enriched_at",
        ]
        read_only_fields = ["uploaded_by", "file_url", "filename", "auto_generated", "enriched_at"]

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


class MeetingActionItemSerializer(serializers.ModelSerializer):
    introduced_in_title = serializers.SerializerMethodField()
    last_changed_in_title = serializers.SerializerMethodField()

    class Meta:
        model = MeetingActionItem
        fields = "__all__"
        read_only_fields = ["ai_generated", "introduced_in", "last_changed_in"]

    @extend_schema_field(_NULL_STR)
    def get_introduced_in_title(self, obj):
        return obj.introduced_in.title if obj.introduced_in_id else None

    @extend_schema_field(_NULL_STR)
    def get_last_changed_in_title(self, obj):
        return obj.last_changed_in.title if obj.last_changed_in_id else None


class ProgressReportSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ProgressReport
        fields = "__all__"
        read_only_fields = [
            "created_by", "ai_status", "ai_output", "summary", "pushback",
            "verified_count", "needs_info_count", "ai_model",
        ]

    @extend_schema_field(_NULL_STR)
    def get_created_by_name(self, obj):
        return _user_name(obj.created_by)


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
    blocked_by_name = serializers.SerializerMethodField()
    implemented_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ChangeRequest
        fields = "__all__"
        read_only_fields = ["created_by", "blocked_by", "implemented_by", "blocked_at", "implemented_at"]

    @extend_schema_field(_NULL_STR)
    def get_owner_name(self, obj):
        return _user_name(obj.owner)

    @extend_schema_field(_NULL_STR)
    def get_created_by_name(self, obj):
        return _user_name(obj.created_by)

    @extend_schema_field(_NULL_STR)
    def get_blocked_by_name(self, obj):
        return _user_name(obj.blocked_by)

    @extend_schema_field(_NULL_STR)
    def get_implemented_by_name(self, obj):
        return _user_name(obj.implemented_by)


class ApprovalRecordSerializer(serializers.ModelSerializer):
    approver_name = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalRecord
        fields = "__all__"
        read_only_fields = ["approver"]

    @extend_schema_field(_NULL_STR)
    def get_approver_name(self, obj):
        return _user_name(obj.approver)


class BuildSectionReviewSerializer(serializers.ModelSerializer):
    completed_by_name = serializers.SerializerMethodField()
    blocked_by_name = serializers.SerializerMethodField()

    class Meta:
        model = BuildSectionReview
        fields = "__all__"
        read_only_fields = [
            "completed_by", "blocked_by", "completed_at", "blocked_at", "updated_at",
        ]

    @extend_schema_field(_NULL_STR)
    def get_completed_by_name(self, obj):
        return _user_name(obj.completed_by)

    @extend_schema_field(_NULL_STR)
    def get_blocked_by_name(self, obj):
        return _user_name(obj.blocked_by)


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
    tasks = TaskCardSerializer(many=True, read_only=True)
    documents = DocumentSerializer(many=True, read_only=True)
    comments = CommentSerializer(many=True, read_only=True)
    change_requests = ChangeRequestSerializer(many=True, read_only=True)
    approvals = ApprovalRecordSerializer(many=True, read_only=True)
    section_reviews = BuildSectionReviewSerializer(many=True, read_only=True)
    memory_snapshots = BuildMemorySnapshotSerializer(many=True, read_only=True)
    activities = ActivitySerializer(many=True, read_only=True)
    action_items = MeetingActionItemSerializer(many=True, read_only=True)
    progress_reports = ProgressReportSerializer(many=True, read_only=True)

    class Meta(BuildListSerializer.Meta):
        fields = BuildListSerializer.Meta.fields + [
            "overview", "one_line_summary", "maintenance_notes", "tasklist_status",
            "build_document", "build_document_at",
            "tasks", "documents", "comments", "change_requests", "approvals", "section_reviews",
            "memory_snapshots", "activities", "action_items", "progress_reports",
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
