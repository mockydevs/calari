"""
Onboarding Intelligence — turns Fireflies onboarding-call transcripts into Asana
tasks, Slack summaries, and enriched Google Drive docs, killing the ~20% info loss at
client handoffs. See docs/onboarding-intelligence-specs.md.

Reuses the builds AI core (provider-agnostic _chat, encrypted key storage, Celery,
telemetry, RAG). Client = projects.Clients.
"""
import uuid
from django.conf import settings
from django.db import models
from builds.models import TaskType

USER = settings.AUTH_USER_MODEL


class SlackIntakeSettings(models.Model):
    enabled = models.BooleanField(default=False)
    workspace_id = models.CharField(max_length=32, blank=True, default="")
    clare_user_id = models.CharField(max_length=32, blank=True, default="")
    encrypted_signing_secret = models.TextField(blank=True, default="")


class SlackChannel(models.Model):
    channel_id = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=120)
    client = models.ForeignKey("projects.Clients", on_delete=models.PROTECT)
    active = models.BooleanField(default=True)
    context_enabled = models.BooleanField(default=False)
    context_revision = models.UUIDField(default=uuid.uuid4, editable=False)
    # A fenced lease serializes a channel without holding a DB lock during AI calls.
    lease_token = models.CharField(max_length=36, blank=True, default="")
    lease_until = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["name", "id"]


class SlackResponsibility(models.Model):
    channel = models.ForeignKey(SlackChannel, on_delete=models.CASCADE, related_name="responsibilities")
    category = models.CharField(max_length=16, choices=TaskType.choices)
    assignee = models.ForeignKey(USER, on_delete=models.PROTECT)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["channel", "category"], name="slack_channel_category_owner")]


class SlackIntakeEvent(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Awaiting analysis"
        NEEDS_SETUP = "needs_setup", "Routing setup needed"
        ROUTED = "routed", "Assigned"
        IGNORED = "ignored", "No action"

    event_id = models.CharField(max_length=64, unique=True)
    channel = models.ForeignKey(SlackChannel, on_delete=models.PROTECT, related_name="events")
    message_ts = models.CharField(max_length=32)
    thread_ts = models.CharField(max_length=32)
    sender_id = models.CharField(max_length=32)
    text = models.TextField()
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    analysis = models.JSONField(default=dict)
    reason = models.CharField(max_length=255, blank=True, default="")
    received_at = models.DateTimeField(auto_now_add=True)
    source_revision = models.UUIDField(default=uuid.uuid4, editable=False)
    redacted = models.BooleanField(default=False)
    source_updated_ts = models.CharField(max_length=32, blank=True, default="")

    class Meta:
        ordering = ["-id"]
        constraints = [models.UniqueConstraint(fields=["channel", "message_ts"], name="slack_message_once")]
        indexes = [models.Index(fields=["status", "id"]), models.Index(fields=["channel", "thread_ts", "id"])]


class SlackWorkItem(models.Model):
    event = models.ForeignKey(SlackIntakeEvent, on_delete=models.PROTECT, related_name="work_items")
    category = models.CharField(max_length=16)
    task = models.OneToOneField("builds.Task", on_delete=models.PROTECT, related_name="slack_work_item")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["event", "category"], name="slack_event_category_once")]


class SlackTaskMessage(models.Model):
    task = models.ForeignKey("builds.Task", on_delete=models.CASCADE, related_name="slack_messages")
    event = models.ForeignKey(SlackIntakeEvent, on_delete=models.PROTECT)
    category = models.CharField(max_length=16)
    kind = models.CharField(max_length=16)
    interpretation = models.TextField()

    class Meta:
        ordering = ["-id"]
        constraints = [models.UniqueConstraint(fields=["event", "category"], name="slack_task_message_once")]


class InvestigationPolicy(models.Model):
    client = models.OneToOneField("projects.Clients", on_delete=models.CASCADE)
    enabled = models.BooleanField(default=True)
    allow_record_reads = models.BooleanField(default=False)
    retention_days = models.PositiveSmallIntegerField(default=30)
    revision = models.UUIDField(default=uuid.uuid4, editable=False)
    # One fenced lease per client, shared by all its channels.
    lease_token = models.UUIDField(null=True, editable=False)
    lease_until = models.DateTimeField(null=True)


class SlackContextGrant(models.Model):
    """Separate user OAuth grant; never reuse the legacy posting bot connection."""
    workspace_id = models.CharField(max_length=32)
    slack_user_id = models.CharField(max_length=32)
    encrypted_token = models.TextField()
    encrypted_refresh = models.TextField(blank=True, default="")
    expires_at = models.DateTimeField(null=True)
    scopes = models.JSONField(default=list)
    revision = models.UUIDField(default=uuid.uuid4, editable=False)
    connected_by = models.ForeignKey(USER, on_delete=models.PROTECT)
    active = models.BooleanField(default=True)
    capabilities = models.JSONField(default=dict)
    refresh_lease = models.UUIDField(null=True, editable=False)
    refresh_lease_until = models.DateTimeField(null=True)
    updated_at = models.DateTimeField(auto_now=True)


class SlackOAuthAttempt(models.Model):
    nonce = models.CharField(max_length=64, unique=True)
    user = models.ForeignKey(USER, on_delete=models.CASCADE)
    encrypted_verifier = models.TextField()
    expires_at = models.DateTimeField()
    consumed = models.BooleanField(default=False)


class ClientInvestigation(models.Model):
    client = models.ForeignKey("projects.Clients", on_delete=models.CASCADE)
    channel = models.ForeignKey(SlackChannel, on_delete=models.CASCADE, null=True)
    # Slack thread identity or "task:<id>" for a build task.
    source_key = models.CharField(max_length=80)
    revision = models.UUIDField(default=uuid.uuid4, editable=False)
    source_fingerprint = models.CharField(max_length=64)
    status = models.CharField(max_length=16, default="pending", db_index=True)
    reason = models.CharField(max_length=255, blank=True, default="")
    scope = models.JSONField(default=dict)
    record_reference = models.CharField(max_length=120, blank=True, default="")
    queued_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True)
    completed_at = models.DateTimeField(null=True)
    expires_at = models.DateTimeField(null=True, db_index=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["client", "source_key"], name="investigation_client_source")]
        indexes = [models.Index(fields=["status", "queued_at"])]


class InvestigationEvidence(models.Model):
    investigation = models.ForeignKey(ClientInvestigation, on_delete=models.CASCADE, related_name="evidence")
    key = models.CharField(max_length=80)
    source = models.CharField(max_length=16)
    reference = models.CharField(max_length=160)
    observation = models.JSONField(default=dict)
    completeness = models.CharField(max_length=16, default="partial")
    sensitivity = models.CharField(max_length=16, default="internal")
    retrieved_at = models.DateTimeField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["investigation", "key"], name="investigation_evidence_key")]


class StaffBrief(models.Model):
    investigation = models.ForeignKey(ClientInvestigation, on_delete=models.CASCADE, related_name="briefs")
    task = models.OneToOneField("builds.Task", on_delete=models.CASCADE, related_name="staff_brief")
    category = models.CharField(max_length=16)
    content = models.JSONField(default=dict)
    generated_revision = models.UUIDField(null=True)
    draft_text = models.TextField(blank=True, default="")
    draft_version = models.PositiveIntegerField(default=0)
    draft_edited = models.BooleanField(default=False)
    draft_ready = models.BooleanField(default=False)
    draft_stale = models.BooleanField(default=False)
    edited_by = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True)
    updated_at = models.DateTimeField(auto_now=True)


class FathomSettings(models.Model):
    """Single workspace webhook connection; never expose its signing secret."""
    enabled = models.BooleanField(default=False)
    encrypted_webhook_secret = models.TextField(blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)


class FathomRoutingRule(models.Model):
    participant_email = models.EmailField(unique=True)
    build = models.ForeignKey("builds.Build", on_delete=models.CASCADE, related_name="fathom_rules")
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["participant_email"]


class FathomMeeting(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Needs routing"
        ATTACHED = "attached", "Added to build"
        IGNORED = "ignored", "Ignored"

    recording_id = models.CharField(max_length=64, unique=True)
    webhook_id = models.CharField(max_length=255)
    title = models.CharField(max_length=255)
    recording_url = models.URLField(max_length=1000, blank=True, default="")
    occurred_at = models.DateTimeField(null=True, blank=True)
    participant_emails = models.JSONField(default=list)
    summary = models.TextField(blank=True, default="")
    transcript = models.TextField(blank=True, default="")
    action_items = models.JSONField(default=list)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    routing_reason = models.CharField(max_length=255, blank=True, default="")
    note = models.OneToOneField(
        "builds.MeetingNote", on_delete=models.SET_NULL, null=True, blank=True, related_name="fathom_meeting",
    )
    received_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-received_at", "-id"]
        indexes = [models.Index(fields=["status", "-received_at"])]


# ─── Enums ────────────────────────────────────────────────────────────────────
class IntegrationProvider(models.TextChoices):
    FIREFLIES = "FIREFLIES", "Fireflies"
    ASANA = "ASANA", "Asana"
    SLACK = "SLACK", "Slack"
    GDRIVE = "GDRIVE", "Google Drive"


class ConnectionAuthType(models.TextChoices):
    API_KEY = "api_key", "API key"
    OAUTH = "oauth", "OAuth"


class CallInsightStatus(models.TextChoices):
    PENDING = "pending", "Pending"       # ingested, awaiting analysis
    PROCESSING = "processing", "Processing"
    ANALYZED = "analyzed", "Analyzed"    # insight ready, awaiting fan-out
    DISTRIBUTED = "distributed", "Distributed"
    SKIPPED = "skipped", "Skipped"       # no confident client match / disabled
    FAILED = "failed", "Failed"


class EventTarget(models.TextChoices):
    ASANA = "ASANA", "Asana tasks"
    SLACK_INTERNAL = "SLACK_INTERNAL", "Slack (internal)"
    SLACK_EXTERNAL = "SLACK_EXTERNAL", "Slack (external)"
    DRIVE = "DRIVE", "Google Drive doc"


class EventStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    SENT = "sent", "Sent"
    FAILED = "failed", "Failed"
    SKIPPED = "skipped", "Skipped"
    RETRACTED = "retracted", "Retracted"


# ─── Automation guardrails (singleton) ─────────────────────────────────────────
class AutomationSettings(models.Model):
    """Global controls for the unattended pipeline. Because client-facing actions post
    automatically, safety lives here: a kill switch, a confidence floor, and an
    external-posting toggle. One row (pk=1)."""
    enabled = models.BooleanField(default=False)               # global kill switch (off by default)
    external_posting_enabled = models.BooleanField(default=False)  # explicit opt-in for the legacy pipeline
    confidence_threshold = models.FloatField(default=0.6)      # below this → internal-only + ops alert
    ops_alert_channel_id = models.CharField(max_length=64, blank=True, default="")  # Slack channel for skips/failures
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "Automation settings"

    def __str__(self):
        return "Automation settings"

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


# ─── Credentials ──────────────────────────────────────────────────────────────
class Connection(models.Model):
    """An authenticated connection to an external provider. Secrets are encrypted at
    rest (AES-256-GCM, reusing builds' crypto). Generalizes builds.AiApiKey."""
    provider = models.CharField(max_length=16, choices=IntegrationProvider.choices)
    auth_type = models.CharField(max_length=8, choices=ConnectionAuthType.choices, default=ConnectionAuthType.API_KEY)
    label = models.CharField(max_length=120, blank=True, default="")
    encrypted_secret = models.TextField()                 # api key OR oauth access token
    secret_preview = models.CharField(max_length=64, blank=True, default="")
    encrypted_refresh = models.TextField(blank=True, default="")  # oauth refresh token
    scopes = models.TextField(blank=True, default="")
    expires_at = models.DateTimeField(null=True, blank=True)
    workspace_ref = models.CharField(max_length=255, blank=True, default="")  # slack team / asana workspace gid
    active = models.BooleanField(default=True)            # one active per provider
    created_by = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, related_name="onboarding_connections")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["provider", "-updated_at"]
        indexes = [models.Index(fields=["provider", "active"])]

    def __str__(self):
        return f"{self.get_provider_display()} ({self.label or self.secret_preview})"


# ─── Per-client integration registry (the keystone) ───────────────────────────
class IntegrationMap(models.Model):
    """Ties one client to its external identities so every fan-out action resolves
    through a single registry. Anchored on the shared Drive/Asana numbering."""
    client = models.OneToOneField("projects.Clients", on_delete=models.CASCADE, related_name="integration_map")
    client_number = models.CharField(max_length=32, blank=True, default="")  # shared numbering key, e.g. "017"
    # Google Drive
    drive_folder_id = models.CharField(max_length=255, blank=True, default="")
    drive_onboarding_doc_id = models.CharField(max_length=255, blank=True, default="")
    # Asana
    asana_project_gid = models.CharField(max_length=64, blank=True, default="")
    # Slack
    slack_internal_channel_id = models.CharField(max_length=64, blank=True, default="")
    slack_external_channel_id = models.CharField(max_length=64, blank=True, default="")
    # Fireflies → client matching (call attribution)
    match_domains = models.TextField(blank=True, default="")  # comma/newline separated client domains
    match_emails = models.TextField(blank=True, default="")   # comma/newline separated known participant emails
    active = models.BooleanField(default=False)  # gate automation per client (safe ramp)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["client_number", "client_id"]

    def __str__(self):
        return f"IntegrationMap<{self.client_id}>"

    @staticmethod
    def _tokens(text: str) -> list[str]:
        return [t.strip().lower() for t in (text or "").replace("\n", ",").split(",") if t.strip()]

    def domains(self) -> list[str]:
        return self._tokens(self.match_domains)

    def emails(self) -> list[str]:
        return self._tokens(self.match_emails)


# ─── Call insight (AI output + the upsell seed) ────────────────────────────────
class CallInsight(models.Model):
    """Structured AI insight extracted from a Fireflies call. Persisted per call so a
    later predictive agent can mine accumulated insight for upsell signals."""
    client = models.ForeignKey(
        "projects.Clients", on_delete=models.SET_NULL, null=True, blank=True, related_name="call_insights"
    )
    fireflies_call_id = models.CharField(max_length=128, unique=True)
    title = models.CharField(max_length=500, blank=True, default="")
    call_date = models.DateTimeField(null=True, blank=True)
    participants = models.JSONField(default=list, blank=True)   # [{name, email}]
    transcript_url = models.URLField(max_length=1000, blank=True, default="")
    summary = models.TextField(blank=True, default="")
    insight = models.JSONField(null=True, blank=True)           # needs/pain_points/services/action_items/sentiment/upsell_signals
    confidence = models.FloatField(null=True, blank=True)       # 0..1, drives guardrails
    status = models.CharField(max_length=16, choices=CallInsightStatus.choices, default=CallInsightStatus.PENDING)
    raw_transcript = models.TextField(blank=True, default="")
    ai_model = models.CharField(max_length=64, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["client", "status"])]

    def __str__(self):
        return self.title or self.fireflies_call_id


# ─── Outbound action audit (idempotency + retraction) ──────────────────────────
class IntegrationEvent(models.Model):
    """One row per outbound action. dedupe_key makes re-delivery safe; external_ref
    enables retraction; payload_snapshot + error give a full audit trail."""
    call_insight = models.ForeignKey(CallInsight, on_delete=models.CASCADE, related_name="events")
    target = models.CharField(max_length=16, choices=EventTarget.choices)
    dedupe_key = models.CharField(max_length=160, unique=True)  # e.g. "<call_id>:SLACK_INTERNAL"
    status = models.CharField(max_length=12, choices=EventStatus.choices, default=EventStatus.PENDING)
    external_ref = models.CharField(max_length=255, blank=True, default="")  # asana gid / slack ts / drive revision
    attempts = models.IntegerField(default=0)
    error = models.TextField(blank=True, default="")
    payload_snapshot = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["call_insight", "target"])]
