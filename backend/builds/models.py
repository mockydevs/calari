"""
Builds — the Calari delivery system domain, ported from the legacy Next.js/Prisma
backend into Django. Client + User reuse existing models (projects.Clients and the
Auth user); everything else lives here.
"""
from django.conf import settings
from django.db import models

USER = settings.AUTH_USER_MODEL


# ─── Enums ────────────────────────────────────────────────────────────────────
class BuildStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft"
    AI_DRAFTED = "AI_DRAFTED", "AI Drafted"
    ASSIGNED = "ASSIGNED", "Assigned"
    IN_PROGRESS = "IN_PROGRESS", "In Progress"
    READY_FOR_REVIEW = "READY_FOR_REVIEW", "Ready for Review"
    CHANGES_REQUESTED = "CHANGES_REQUESTED", "Changes Requested"
    DELIVERED = "DELIVERED", "Delivered"


class TaskType(models.TextChoices):
    AUTOMATION = "AUTOMATION", "Automation"
    FUNNEL = "FUNNEL", "Funnel"
    FORM = "FORM", "Form"
    INTEGRATION = "INTEGRATION", "Integration"
    OTHER = "OTHER", "Other"


class TaskStatus(models.TextChoices):
    TODO = "TODO", "To Do"
    IN_PROGRESS = "IN_PROGRESS", "In Progress"
    BLOCKED = "BLOCKED", "Blocked"
    DONE = "DONE", "Done"


class ContactSourceType(models.TextChoices):
    WEBSITE = "WEBSITE", "Website"
    ADS = "ADS", "Ads"
    MANUAL = "MANUAL", "Manual"
    OTHER = "OTHER", "Other"


class AIProvider(models.TextChoices):
    OPENAI = "OPENAI", "OpenAI"
    ANTHROPIC = "ANTHROPIC", "Anthropic"
    GOOGLE = "GOOGLE", "Google"
    GROQ = "GROQ", "Groq"
    MISTRAL = "MISTRAL", "Mistral"
    OPENROUTER = "OPENROUTER", "OpenRouter"
    OTHER = "OTHER", "Other"


class ChangeRequestStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    APPROVED = "APPROVED", "Approved"
    REJECTED = "REJECTED", "Rejected"
    IMPLEMENTED = "IMPLEMENTED", "Implemented"


class ApprovalType(models.TextChoices):
    BRIEF = "BRIEF", "Brief"
    CHANGE_REQUEST = "CHANGE_REQUEST", "Change Request"
    DELIVERY = "DELIVERY", "Delivery"
    CLIENT = "CLIENT", "Client"


# ─── Core ─────────────────────────────────────────────────────────────────────
class Build(models.Model):
    title = models.CharField(max_length=500)
    status = models.CharField(max_length=32, choices=BuildStatus.choices, default=BuildStatus.DRAFT)
    goals = models.TextField(blank=True, default="")
    integrations = models.TextField(blank=True, default="")
    client = models.ForeignKey("projects.Clients", on_delete=models.CASCADE, related_name="builds")
    creator = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="created_builds")
    assignee = models.ForeignKey(
        USER, on_delete=models.SET_NULL, null=True, blank=True, related_name="assigned_builds"
    )
    due_date = models.DateTimeField(null=True, blank=True)
    client_portal_enabled = models.BooleanField(default=False)
    client_portal_token = models.CharField(max_length=64, unique=True, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title


class ContactSource(models.Model):
    type = models.CharField(max_length=16, choices=ContactSourceType.choices, default=ContactSourceType.OTHER)
    label = models.CharField(max_length=255)
    build = models.ForeignKey(Build, on_delete=models.CASCADE, related_name="contact_sources")


class PipelineStage(models.Model):
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    order = models.IntegerField(default=0)
    needs_manual = models.BooleanField(default=False)
    build = models.ForeignKey(Build, on_delete=models.CASCADE, related_name="stages")

    class Meta:
        ordering = ["order"]


class ManualAction(models.Model):
    description = models.TextField()
    owner = models.CharField(max_length=255, blank=True, default="")
    stage = models.ForeignKey(PipelineStage, on_delete=models.CASCADE, related_name="manual_actions")


class Task(models.Model):
    title = models.CharField(max_length=500)
    description = models.TextField(blank=True, default="")
    type = models.CharField(max_length=16, choices=TaskType.choices, default=TaskType.OTHER)
    status = models.CharField(max_length=16, choices=TaskStatus.choices, default=TaskStatus.TODO)
    ai_generated = models.BooleanField(default=False)
    progress_note = models.TextField(blank=True, default="")
    build = models.ForeignKey(Build, on_delete=models.CASCADE, related_name="tasks")
    assignee = models.ForeignKey(
        USER, on_delete=models.SET_NULL, null=True, blank=True, related_name="assigned_build_tasks"
    )
    due_date = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return self.title


class TaskDependency(models.Model):
    blocker = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="blocks")
    blocked = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="blocked_by")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["blocker", "blocked"], name="unique_task_dependency"),
        ]
        indexes = [models.Index(fields=["blocked"])]


class Document(models.Model):
    filename = models.CharField(max_length=500)
    url = models.URLField(max_length=1000)
    mime_type = models.CharField(max_length=120, blank=True, default="")
    size_bytes = models.IntegerField(null=True, blank=True)
    ai_readable = models.BooleanField(default=False)
    extracted_text = models.TextField(blank=True, default="")
    build = models.ForeignKey(Build, on_delete=models.CASCADE, null=True, blank=True, related_name="documents")
    task = models.ForeignKey(Task, on_delete=models.CASCADE, null=True, blank=True, related_name="documents")
    uploader = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="build_uploads")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class MeetingNote(models.Model):
    source = models.CharField(max_length=32, default="paste")
    raw_text = models.TextField()
    file_url = models.URLField(max_length=1000, blank=True, default="")
    ai_status = models.CharField(max_length=16, default="pending")  # pending|processing|done|failed
    ai_output = models.JSONField(null=True, blank=True)
    build = models.ForeignKey(Build, on_delete=models.CASCADE, related_name="meeting_notes")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]


class Comment(models.Model):
    body = models.TextField()
    build = models.ForeignKey(Build, on_delete=models.CASCADE, null=True, blank=True, related_name="comments")
    task = models.ForeignKey(Task, on_delete=models.CASCADE, null=True, blank=True, related_name="comments")
    author = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="build_comments")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]


class Activity(models.Model):
    build = models.ForeignKey(Build, on_delete=models.CASCADE, related_name="activities")
    actor = models.CharField(max_length=255)
    message = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class ChangeRequest(models.Model):
    title = models.CharField(max_length=500)
    description = models.TextField()
    impact = models.TextField(blank=True, default="")
    status = models.CharField(max_length=16, choices=ChangeRequestStatus.choices, default=ChangeRequestStatus.PENDING)
    requester = models.CharField(max_length=255, blank=True, default="")
    due_date = models.DateTimeField(null=True, blank=True)
    build = models.ForeignKey(Build, on_delete=models.CASCADE, related_name="change_requests")
    owner = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, blank=True, related_name="owned_changes")
    created_by = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="created_changes")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["build", "status"])]


class ApprovalRecord(models.Model):
    type = models.CharField(max_length=20, choices=ApprovalType.choices)
    note = models.TextField(blank=True, default="")
    build = models.ForeignKey(Build, on_delete=models.CASCADE, related_name="approvals")
    approver = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="build_approvals")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["build", "type"])]


class BuildMemorySnapshot(models.Model):
    summary = models.TextField()
    open_questions = models.TextField(blank=True, default="")
    scope_changes = models.TextField(blank=True, default="")
    created_by_ai = models.BooleanField(default=False)
    build = models.ForeignKey(Build, on_delete=models.CASCADE, related_name="memory_snapshots")
    created_by = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, blank=True, related_name="memory_snapshots")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["build", "created_at"])]


class ClientPortalFeedback(models.Model):
    name = models.CharField(max_length=255, blank=True, default="")
    message = models.TextField()
    build = models.ForeignKey(Build, on_delete=models.CASCADE, related_name="portal_feedback")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["build", "created_at"])]


class Notification(models.Model):
    type = models.CharField(max_length=64)
    message = models.TextField()
    link = models.CharField(max_length=500, blank=True, default="")
    read = models.BooleanField(default=False)
    user = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="build_notifications")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class NotificationPreference(models.Model):
    user = models.OneToOneField(USER, on_delete=models.CASCADE, related_name="notification_preference")
    build_assigned = models.BooleanField(default=True)
    task_updated = models.BooleanField(default=True)
    follow_up_notes = models.BooleanField(default=True)
    change_requests = models.BooleanField(default=True)
    ready_for_review = models.BooleanField(default=True)
    document_uploaded = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class AiApiKey(models.Model):
    provider = models.CharField(max_length=16, choices=AIProvider.choices)
    label = models.CharField(max_length=255)
    encrypted_key = models.TextField()
    key_preview = models.CharField(max_length=32)
    active = models.BooleanField(default=True)
    created_by = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="created_api_keys")
    updated_by = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, blank=True, related_name="updated_api_keys")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["provider", "active"])]


class TeamInvite(models.Model):
    email = models.EmailField()
    name = models.CharField(max_length=255)
    role = models.CharField(max_length=32, default="employee")
    token_hash = models.CharField(max_length=128, unique=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField()
    invited_by = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="sent_invites")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["email"]), models.Index(fields=["expires_at"])]
