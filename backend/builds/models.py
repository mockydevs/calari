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


class MeetingNoteKind(models.TextChoices):
    """What a meeting note represents — drives its auto-title and how it's used.
    KICKOFF/MEETING feed full blueprint (re)generation; PROGRESS/CHANGE_REQUEST run
    the delta flow (capture changes/progress without rewriting the whole vision)."""
    KICKOFF = "kickoff", "Kickoff"
    MEETING = "meeting", "Meeting notes"
    PROGRESS = "progress", "Progress update"
    CHANGE_REQUEST = "change_request", "Client-requested update"
    OTHER = "other", "Other"


class ActionItemCategory(models.TextChoices):
    """What a captured meeting item is — kept literal so nothing the client said is
    re-interpreted away. Drives grouping in the staff tasklist."""
    REQUEST = "REQUEST", "Request / task"
    CHANGE = "CHANGE", "Change to existing scope"
    QUESTION = "QUESTION", "Open question"
    DECISION = "DECISION", "Decision made"
    INFO = "INFO", "Info / note"


class ActionItemStatus(models.TextChoices):
    OPEN = "OPEN", "Open"
    IN_PROGRESS = "IN_PROGRESS", "In Progress"
    DONE = "DONE", "Done"
    DROPPED = "DROPPED", "Dropped"


class ActionItemVerification(models.TextChoices):
    """How confident we are that an item was actually & correctly built, based on the
    AI's strict audit of staff progress reports."""
    UNVERIFIED = "UNVERIFIED", "Unverified"     # not yet reviewed against a progress report
    VERIFIED = "VERIFIED", "Verified"           # report demonstrated a correct, complete build
    NEEDS_INFO = "NEEDS_INFO", "Needs info"     # AI pushed back — missing/unclear/incorrect


class ProgressReportStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    PROCESSING = "processing", "Processing"
    DONE = "done", "Done"
    FAILED = "failed", "Failed"


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
    IN_BUILD = "IN_BUILD", "In Build"
    BLOCKED = "BLOCKED", "Blocked"
    DEFERRED = "DEFERRED", "Deferred"
    REJECTED = "REJECTED", "Rejected"
    IMPLEMENTED = "IMPLEMENTED", "Implemented"


class ApprovalType(models.TextChoices):
    BRIEF = "BRIEF", "Brief"
    CHANGE_REQUEST = "CHANGE_REQUEST", "Change Request"
    DELIVERY = "DELIVERY", "Delivery"
    CLIENT = "CLIENT", "Client"


class BuildSection(models.TextChoices):
    PIPELINE = "PIPELINE", "Pipeline"
    AUTOMATIONS = "AUTOMATIONS", "Automations"
    CLIENT_UPDATES = "CLIENT_UPDATES", "New features & updates"
    LEAD_SOURCES = "LEAD_SOURCES", "Lead sources"
    CALENDARS = "CALENDARS", "Calendars"
    INTEGRATIONS = "INTEGRATIONS", "Integrations"
    FIELDS_TAGS = "FIELDS_TAGS", "Fields & tags"
    FORMS_PAYMENTS = "FORMS_PAYMENTS", "Forms & payments"
    REPORTING_LAUNCH = "REPORTING_LAUNCH", "Reporting & launch"


class BuildSectionReviewStatus(models.TextChoices):
    TODO = "TODO", "To do"
    DONE = "DONE", "Done"
    BLOCKED = "BLOCKED", "Blocked"


# ─── Core ─────────────────────────────────────────────────────────────────────
class Build(models.Model):
    title = models.CharField(max_length=500)
    status = models.CharField(max_length=32, choices=BuildStatus.choices, default=BuildStatus.DRAFT)
    goals = models.TextField(blank=True, default="")
    integrations = models.TextField(blank=True, default="")
    # ── Vision blueprint narrative (mirrors the client handover anatomy) ──
    overview = models.TextField(blank=True, default="")          # "The big idea"
    one_line_summary = models.TextField(blank=True, default="")  # one-line summary for the team
    maintenance_notes = models.TextField(blank=True, default="")  # env vars, services, cadence
    # Rolling "build memory" — current-state summary kept fresh by progress updates
    # so the build never loses early context as meeting history grows.
    memory_summary = models.TextField(blank=True, default="")
    # Async state of the source-faithful meeting tasklist (separate from the
    # blueprint flow, which tracks state on the meeting note). Polled by the UI.
    tasklist_status = models.CharField(max_length=16, blank=True, default="")  # ""|processing|done|failed
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


class Task(models.Model):
    title = models.CharField(max_length=500)
    description = models.TextField(blank=True, default="")
    type = models.CharField(max_length=16, choices=TaskType.choices, default=TaskType.OTHER)
    status = models.CharField(max_length=16, choices=TaskStatus.choices, default=TaskStatus.TODO)
    ai_generated = models.BooleanField(default=False)
    locked = models.BooleanField(default=False)  # protect from regeneration wipe (set on human edit)
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
    kind = models.CharField(max_length=20, choices=MeetingNoteKind.choices, default=MeetingNoteKind.MEETING)
    title = models.CharField(max_length=255, blank=True, default="")  # auto: "2nd Meeting notes", etc.
    meeting_date = models.DateField(null=True, blank=True)
    file_url = models.URLField(max_length=1000, blank=True, default="")
    ai_status = models.CharField(max_length=16, default="pending")  # pending|processing|done|failed
    ai_output = models.JSONField(null=True, blank=True)
    ai_model = models.CharField(max_length=64, blank=True, default="")  # model that produced ai_output
    build = models.ForeignKey(Build, on_delete=models.CASCADE, related_name="meeting_notes")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]


class MeetingActionItem(models.Model):
    """A single requested task / change / question captured VERBATIM from a meeting
    note. Unlike the blueprint Task (which is abstracted from the vision and can drop
    detail), this is a faithful, exhaustive record of what the client actually asked —
    one living list per build, reconciled across meetings so nothing is ever lost.

    Provenance mirrors BlueprintItemMixin: `ai_generated` marks AI-authored rows and
    `locked` protects a row from re-sync (set when a human edits it), so re-running
    extraction never wipes human work."""
    build = models.ForeignKey(Build, on_delete=models.CASCADE, related_name="action_items")
    text = models.TextField()  # the request, in the client's words
    detail = models.TextField(blank=True, default="")  # short clarifying context
    category = models.CharField(
        max_length=16, choices=ActionItemCategory.choices, default=ActionItemCategory.REQUEST
    )
    # Which GHL area this item belongs to — the primary grouping. Lets us organize a
    # purely notes-driven plan into familiar GHL sections WITHOUT forcing the build
    # into a rigid pre-defined architecture. Blank = not yet categorized.
    section = models.CharField(max_length=20, choices=BuildSection.choices, blank=True, default="")
    status = models.CharField(
        max_length=16, choices=ActionItemStatus.choices, default=ActionItemStatus.OPEN
    )
    # Which meeting first surfaced this item, and which one last changed it.
    introduced_in = models.ForeignKey(
        MeetingNote, on_delete=models.SET_NULL, null=True, blank=True, related_name="introduced_action_items"
    )
    last_changed_in = models.ForeignKey(
        MeetingNote, on_delete=models.SET_NULL, null=True, blank=True, related_name="changed_action_items"
    )
    # Reversed / withdrawn asks are kept (not deleted) for an audit trail.
    superseded = models.BooleanField(default=False)
    superseded_reason = models.TextField(blank=True, default="")
    # ── Build verification (driven by AI audit of staff progress reports) ──
    verification = models.CharField(
        max_length=12, choices=ActionItemVerification.choices, default=ActionItemVerification.UNVERIFIED
    )
    evidence = models.TextField(blank=True, default="")        # what the report showed for this item
    verification_note = models.TextField(blank=True, default="")  # AI pushback / clarification needed
    ai_generated = models.BooleanField(default=False)
    locked = models.BooleanField(default=False)  # protect from re-sync wipe (set on human edit)
    order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["order", "created_at"]
        indexes = [models.Index(fields=["build", "superseded"])]

    def __str__(self):
        return self.text[:80]


class ProgressReport(models.Model):
    """A staff progress report (pasted or uploaded) covering work done over part of a
    build. The AI audits it against the tasklist — checking off genuinely-completed
    items and pushing back on anything missing, incomplete, or incorrectly built."""
    build = models.ForeignKey(Build, on_delete=models.CASCADE, related_name="progress_reports")
    source = models.CharField(max_length=32, default="paste")  # paste | upload
    raw_text = models.TextField()
    file_url = models.URLField(max_length=1000, blank=True, default="")
    ai_status = models.CharField(
        max_length=16, choices=ProgressReportStatus.choices, default=ProgressReportStatus.PENDING
    )
    ai_output = models.JSONField(null=True, blank=True)  # full audit result
    summary = models.TextField(blank=True, default="")   # AI's headline summary
    pushback = models.JSONField(default=list, blank=True)  # list of expert clarification asks
    verified_count = models.IntegerField(default=0)
    needs_info_count = models.IntegerField(default=0)
    ai_model = models.CharField(max_length=64, blank=True, default="")
    created_by = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, related_name="build_progress_reports")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


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
    blocker_note = models.TextField(blank=True, default="")
    blocker_attachment_url = models.URLField(max_length=1000, blank=True, default="")
    blocker_attachment_name = models.CharField(max_length=500, blank=True, default="")
    implementation_steps = models.TextField(blank=True, default="")
    build = models.ForeignKey(Build, on_delete=models.CASCADE, related_name="change_requests")
    owner = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, blank=True, related_name="owned_changes")
    created_by = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="created_changes")
    blocked_by = models.ForeignKey(
        USER, on_delete=models.SET_NULL, null=True, blank=True, related_name="blocked_change_requests"
    )
    implemented_by = models.ForeignKey(
        USER, on_delete=models.SET_NULL, null=True, blank=True, related_name="implemented_change_requests"
    )
    blocked_at = models.DateTimeField(null=True, blank=True)
    implemented_at = models.DateTimeField(null=True, blank=True)
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


class BuildSectionReview(models.Model):
    """Staff implementation status for a major blueprint section.

    This lets the assigned builder work section-by-section (Automations, Pipeline,
    etc.) without flattening everything into one task list. Blockers are routed
    back to the build admin with the exact section context.
    """
    build = models.ForeignKey(Build, on_delete=models.CASCADE, related_name="section_reviews")
    section = models.CharField(max_length=32, choices=BuildSection.choices)
    status = models.CharField(
        max_length=16, choices=BuildSectionReviewStatus.choices, default=BuildSectionReviewStatus.TODO
    )
    blocker_note = models.TextField(blank=True, default="")
    blocker_attachment_url = models.URLField(max_length=1000, blank=True, default="")
    blocker_attachment_name = models.CharField(max_length=500, blank=True, default="")
    blocker_history = models.JSONField(blank=True, default=list)
    completed_by = models.ForeignKey(
        USER, on_delete=models.SET_NULL, null=True, blank=True, related_name="completed_build_sections"
    )
    blocked_by = models.ForeignKey(
        USER, on_delete=models.SET_NULL, null=True, blank=True, related_name="blocked_build_sections"
    )
    completed_at = models.DateTimeField(null=True, blank=True)
    blocked_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["section"]
        constraints = [
            models.UniqueConstraint(fields=["build", "section"], name="unique_build_section_review"),
        ]
        indexes = [models.Index(fields=["build", "status"])]


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


class AiConfig(models.Model):
    """Singleton: which provider + model the AI generation uses (chosen in
    Settings → AI Keys). The active KEY *within* a provider is selected separately
    (AiApiKey.active). Blank model fields fall back to a sensible provider default."""
    provider = models.CharField(max_length=16, choices=AIProvider.choices, default=AIProvider.OPENAI)
    model = models.CharField(max_length=64, blank=True, default="")            # blank → provider default
    blueprint_model = models.CharField(max_length=64, blank=True, default="")  # blank → falls back to `model`
    multi_pass = models.BooleanField(default=False)  # architect→critic→revise on the blueprint
    updated_by = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return f"AiConfig(provider={self.provider}, model={self.model or 'default'})"


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


class AiGenerationLog(models.Model):
    """Per-call AI telemetry: provider/model, token usage, latency, success. Powers
    cost + observability dashboards and lets you compare models/prompts over time."""
    op = models.CharField(max_length=32, default="chat")  # blueprint|qa|sop|gap_suggest|progress_delta|embed|…
    provider = models.CharField(max_length=16, blank=True, default="")
    model = models.CharField(max_length=64, blank=True, default="")
    prompt_tokens = models.IntegerField(null=True, blank=True)
    completion_tokens = models.IntegerField(null=True, blank=True)
    total_tokens = models.IntegerField(null=True, blank=True)
    latency_ms = models.IntegerField(null=True, blank=True)
    ok = models.BooleanField(default=True)
    error = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["op", "created_at"]), models.Index(fields=["created_at"])]


class BuildKnowledge(models.Model):
    """A past-build / client documentation artifact the team uploads to the shared
    Build Library. Its extracted text feeds the AI as reference material so the
    blueprint generator learns from how Calari actually builds (improvement: the
    learning loop). Any staff member can contribute; `use_for_ai` lets a doc be
    excluded from generation context if needed."""
    title = models.CharField(max_length=300)
    # Optional links — a doc may be tied to a specific client/build or be general.
    client = models.ForeignKey(
        "projects.Clients", on_delete=models.SET_NULL, null=True, blank=True, related_name="knowledge_docs"
    )
    build = models.ForeignKey(
        Build, on_delete=models.SET_NULL, null=True, blank=True, related_name="knowledge_docs"
    )
    file_url = models.URLField(max_length=1000, blank=True, default="")
    filename = models.CharField(max_length=500, blank=True, default="")
    raw_text = models.TextField(blank=True, default="")        # extracted text the AI reads
    summary = models.TextField(blank=True, default="")          # optional short summary for context
    use_for_ai = models.BooleanField(default=True)              # include in generation context
    uploaded_by = models.ForeignKey(
        USER, on_delete=models.SET_NULL, null=True, blank=True, related_name="knowledge_uploads"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["use_for_ai", "client"])]

    def __str__(self):
        return self.title
