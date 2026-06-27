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


class WorkflowCategory(models.TextChoices):
    """Mirrors the handover's name-prefix grouping (A / IN / REC / E,K / G / H,X,Y,Z)."""
    ACTIVE_CONVERSION = "ACTIVE_CONVERSION", "Active conversion (A)"
    INTAKE_ROUTING = "INTAKE_ROUTING", "Intake & routing (IN)"
    RECORD_KEEPING = "RECORD_KEEPING", "Record-keeping (REC)"
    APPOINTMENT_LIFECYCLE = "APPOINTMENT_LIFECYCLE", "Appointment lifecycle (E, K)"
    POST_VISIT = "POST_VISIT", "Post-visit & retention (G)"
    INTERNAL_UTILITY = "INTERNAL_UTILITY", "Internal & utility (H, X, Y, Z)"
    OTHER = "OTHER", "Other"


class CustomFieldKind(models.TextChoices):
    FIELD = "FIELD", "Custom field"
    VALUE = "VALUE", "Custom value"


class CalendarType(models.TextChoices):
    """GHL calendar types — the booking object that converts a nurtured lead."""
    ROUND_ROBIN = "ROUND_ROBIN", "Round robin"
    COLLECTIVE = "COLLECTIVE", "Collective"
    CLASS = "CLASS", "Class / group"
    SERVICE = "SERVICE", "Service"
    PERSONAL = "PERSONAL", "Personal"
    OTHER = "OTHER", "Other"


class IntegrationDirection(models.TextChoices):
    INBOUND = "INBOUND", "Inbound (into GHL)"
    OUTBOUND = "OUTBOUND", "Outbound (out of GHL)"
    BIDIRECTIONAL = "BIDIRECTIONAL", "Bidirectional"


class IntegrationMechanism(models.TextChoices):
    API = "API", "API"
    WEBHOOK = "WEBHOOK", "Webhook"
    NATIVE = "NATIVE", "Native integration"
    ZAPIER = "ZAPIER", "Zapier / Make"
    CRON = "CRON", "Scheduled sync (cron)"
    OTHER = "OTHER", "Other"


class MeetingNoteKind(models.TextChoices):
    """What a meeting note represents — drives its auto-title and how it's used.
    KICKOFF/MEETING feed full blueprint (re)generation; PROGRESS/CHANGE_REQUEST run
    the delta flow (capture changes/progress without rewriting the whole vision)."""
    KICKOFF = "kickoff", "Kickoff"
    MEETING = "meeting", "Meeting notes"
    PROGRESS = "progress", "Progress update"
    CHANGE_REQUEST = "change_request", "Client-requested update"
    OTHER = "other", "Other"


class GapCategory(models.TextChoices):
    """Which part of the vision a gap relates to — drives where the AI probes."""
    OVERVIEW = "OVERVIEW", "Overview / big idea"
    STAGE = "STAGE", "Pipeline stage"
    TRANSITION = "TRANSITION", "Stage movement"
    LEAD_SOURCE = "LEAD_SOURCE", "Lead source"
    CALENDAR = "CALENDAR", "Calendar / booking"
    INTEGRATION = "INTEGRATION", "Integration / data flow"
    WORKFLOW = "WORKFLOW", "Workflow"
    CUSTOM_FIELD = "CUSTOM_FIELD", "Custom field / value"
    TAG = "TAG", "Tag"
    GENERAL = "GENERAL", "General"


class GapSeverity(models.TextChoices):
    HIGH = "high", "High"
    MEDIUM = "medium", "Medium"
    LOW = "low", "Low"


class GapStatus(models.TextChoices):
    OPEN = "OPEN", "Open"
    ANSWERED = "ANSWERED", "Answered"
    DISMISSED = "DISMISSED", "Dismissed"


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


class BlueprintItemMixin(models.Model):
    """Provenance + regeneration controls shared by every AI-extractable blueprint
    item. `ai_generated` marks AI-authored rows (so regeneration only wipes those);
    `locked` protects a row from being wiped on regenerate (set when a human edits
    it). `inferred`/`confidence` record whether the AI inferred the item vs. read it
    from the notes, and how sure it is — for reviewer trust."""
    ai_generated = models.BooleanField(default=False)
    locked = models.BooleanField(default=False)
    inferred = models.BooleanField(default=False)
    confidence = models.CharField(max_length=8, blank=True, default="")  # high|medium|low|""

    class Meta:
        abstract = True


class PipelineStage(BlueprintItemMixin):
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")     # "what it means"
    entry_condition = models.TextField(blank=True, default="")  # "how a lead gets here"
    order = models.IntegerField(default=0)
    needs_manual = models.BooleanField(default=False)
    is_automatic = models.BooleanField(default=True)  # auto-advances on a reliable signal
    build = models.ForeignKey(Build, on_delete=models.CASCADE, related_name="stages")

    class Meta:
        ordering = ["order"]

    def __str__(self):
        return self.name


class ContactSource(BlueprintItemMixin):
    type = models.CharField(max_length=16, choices=ContactSourceType.choices, default=ContactSourceType.OTHER)
    label = models.CharField(max_length=255)
    # ── Lead-source mechanics (how it enters the pipeline) ──
    entry_mechanism = models.TextField(blank=True, default="")    # form trigger, webhook, cron sync, etc.
    fires = models.TextField(blank=True, default="")             # side effects fired (Meta CAPI, alerts…)
    tags_applied = models.CharField(max_length=500, blank=True, default="")
    handling_workflow = models.CharField(max_length=255, blank=True, default="")  # e.g. "IN1"
    entry_stage = models.ForeignKey(
        PipelineStage, on_delete=models.SET_NULL, null=True, blank=True, related_name="entry_sources"
    )
    notes = models.TextField(blank=True, default="")
    order = models.IntegerField(default=0)
    build = models.ForeignKey(Build, on_delete=models.CASCADE, related_name="contact_sources")

    class Meta:
        ordering = ["order"]


class ManualAction(models.Model):
    description = models.TextField()
    owner = models.CharField(max_length=255, blank=True, default="")
    stage = models.ForeignKey(PipelineStage, on_delete=models.CASCADE, related_name="manual_actions")


class Calendar(BlueprintItemMixin):
    """A GHL calendar — the booking object where a nurtured lead converts.

    Nurture sequences (Workflow category ACTIVE_CONVERSION) push contacts toward
    booking on one of these; a booking is typically the conversion event that moves
    the opportunity into an "Appointment Booked"-style stage.
    """
    build = models.ForeignKey(Build, on_delete=models.CASCADE, related_name="calendars")
    name = models.CharField(max_length=255)
    type = models.CharField(max_length=16, choices=CalendarType.choices, default=CalendarType.OTHER)
    purpose = models.TextField(blank=True, default="")          # what it books: consult, in-person visit, demo…
    booking_url = models.CharField(max_length=1000, blank=True, default="")
    assigned_to = models.CharField(max_length=500, blank=True, default="")  # team members / providers
    # The conversion wiring: where a booking lands and what it fires.
    books_into_stage = models.ForeignKey(
        PipelineStage, on_delete=models.SET_NULL, null=True, blank=True, related_name="booking_calendars"
    )
    on_booking = models.TextField(blank=True, default="")       # what happens on booking (workflow, tags, reminders)
    reminders = models.TextField(blank=True, default="")        # reminder/confirmation cadence
    notes = models.TextField(blank=True, default="")
    order = models.IntegerField(default=0)

    class Meta:
        ordering = ["order"]

    def __str__(self):
        return self.name


class Integration(BlueprintItemMixin):
    """An external system wired to GHL — inbound, outbound, or bidirectional.

    Covers the full data-flow picture beyond lead entry: tools that feed contacts
    in (Patient Prism, Modento, web apps), and where GHL pushes data out (ERP,
    external DB, quotes, invoices, accounting).
    """
    build = models.ForeignKey(Build, on_delete=models.CASCADE, related_name="external_integrations")
    name = models.CharField(max_length=255)                     # Patient Prism, Modento, QuickBooks, custom ERP…
    direction = models.CharField(
        max_length=16, choices=IntegrationDirection.choices, default=IntegrationDirection.INBOUND
    )
    mechanism = models.CharField(
        max_length=16, choices=IntegrationMechanism.choices, default=IntegrationMechanism.API
    )
    data_objects = models.CharField(max_length=500, blank=True, default="")  # contacts, appointments, quotes, invoices…
    purpose = models.TextField(blank=True, default="")
    trigger_cadence = models.CharField(max_length=255, blank=True, default="")  # real-time, daily cron, on stage change
    endpoint = models.CharField(max_length=1000, blank=True, default="")        # URL/service (no secrets)
    notes = models.TextField(blank=True, default="")
    order = models.IntegerField(default=0)

    class Meta:
        ordering = ["order"]

    def __str__(self):
        return self.name


class StageTransition(BlueprintItemMixin):
    """An edge between stages — the movement that keeps the build true to the vision."""
    build = models.ForeignKey(Build, on_delete=models.CASCADE, related_name="transitions")
    from_stage = models.ForeignKey(
        PipelineStage, on_delete=models.CASCADE, null=True, blank=True, related_name="transitions_out"
    )
    to_stage = models.ForeignKey(
        PipelineStage, on_delete=models.CASCADE, null=True, blank=True, related_name="transitions_in"
    )
    # Free-text labels preserved even if a stage can't be resolved (AI gives names).
    from_label = models.CharField(max_length=255, blank=True, default="")
    to_label = models.CharField(max_length=255, blank=True, default="")
    trigger = models.TextField()  # what causes the move
    is_automatic = models.BooleanField(default=True)
    notes = models.TextField(blank=True, default="")
    order = models.IntegerField(default=0)

    class Meta:
        ordering = ["order"]


class Workflow(BlueprintItemMixin):
    """An automation/workflow in the delivered system (handover §5)."""
    build = models.ForeignKey(Build, on_delete=models.CASCADE, related_name="workflows")
    code = models.CharField(max_length=32, blank=True, default="")  # e.g. "A1", "IN3", "K4"
    category = models.CharField(
        max_length=32, choices=WorkflowCategory.choices, default=WorkflowCategory.OTHER
    )
    name = models.CharField(max_length=255)
    trigger = models.CharField(max_length=500, blank=True, default="")
    what_it_does = models.TextField(blank=True, default="")
    patient_facing = models.BooleanField(default=False)
    order = models.IntegerField(default=0)

    class Meta:
        ordering = ["category", "order", "code"]

    def __str__(self):
        return f"{self.code} {self.name}".strip()


class CustomField(BlueprintItemMixin):
    """A custom field or custom value the system relies on (handover §6)."""
    build = models.ForeignKey(Build, on_delete=models.CASCADE, related_name="custom_fields")
    kind = models.CharField(max_length=8, choices=CustomFieldKind.choices, default=CustomFieldKind.FIELD)
    key = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    populated = models.BooleanField(default=True)  # False = still needs a value (a gap)
    order = models.IntegerField(default=0)

    class Meta:
        ordering = ["kind", "order", "key"]


class TagDefinition(BlueprintItemMixin):
    """An entry in the tag glossary (handover §6)."""
    build = models.ForeignKey(Build, on_delete=models.CASCADE, related_name="tags")
    tag = models.CharField(max_length=255)
    meaning = models.CharField(max_length=500, blank=True, default="")
    order = models.IntegerField(default=0)

    class Meta:
        ordering = ["order", "tag"]


class PreLaunchItem(BlueprintItemMixin):
    """A pre-launch checklist line (handover §8)."""
    build = models.ForeignKey(Build, on_delete=models.CASCADE, related_name="pre_launch_items")
    description = models.TextField()
    optional = models.BooleanField(default=False)
    done = models.BooleanField(default=False)
    order = models.IntegerField(default=0)

    class Meta:
        ordering = ["order"]


class VisionGap(models.Model):
    """A piece of the vision the AI couldn't pin down — with a targeted follow-up question.

    This is what makes the AI "always seek the structure": after each pass it records
    what's missing so the team (or the next round of notes) can close it.
    """
    build = models.ForeignKey(Build, on_delete=models.CASCADE, related_name="gaps")
    category = models.CharField(max_length=16, choices=GapCategory.choices, default=GapCategory.GENERAL)
    question = models.TextField()           # the targeted follow-up to ask the client/team
    rationale = models.TextField(blank=True, default="")  # why this matters to the build
    severity = models.CharField(max_length=8, choices=GapSeverity.choices, default=GapSeverity.MEDIUM)
    status = models.CharField(max_length=12, choices=GapStatus.choices, default=GapStatus.OPEN)
    answer = models.TextField(blank=True, default="")
    created_by_ai = models.BooleanField(default=True)
    resolved_by = models.ForeignKey(
        USER, on_delete=models.SET_NULL, null=True, blank=True, related_name="resolved_gaps"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["status", "-severity", "created_at"]
        indexes = [models.Index(fields=["build", "status"])]


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
