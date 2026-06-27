"""
Onboarding Intelligence — turns Fireflies onboarding-call transcripts into Asana
tasks, Slack summaries, and enriched Google Drive docs, killing the ~20% info loss at
client handoffs. See docs/onboarding-intelligence-specs.md.

Reuses the builds AI core (provider-agnostic _chat, encrypted key storage, Celery,
telemetry, RAG). Client = projects.Clients.
"""
from django.conf import settings
from django.db import models

USER = settings.AUTH_USER_MODEL


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
    external_posting_enabled = models.BooleanField(default=True)  # allow posting to client (external) Slack
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
