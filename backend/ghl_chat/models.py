"""Private conversations, explicit account grants, and durable execution receipts."""
import uuid

from django.conf import settings
from django.db import models


class Account(models.Model):
    client = models.OneToOneField('projects.Clients', on_delete=models.PROTECT)
    synthetic = models.BooleanField(default=False)
    enabled = models.BooleanField(default=True)
    timezone = models.CharField(max_length=80, default='UTC')


class Grant(models.Model):
    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name='grants')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    can_execute = models.BooleanField(default=False)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['account', 'user'], name='chat_account_user')]


class Conversation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey(Account, on_delete=models.PROTECT)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    title = models.CharField(max_length=160)
    created_at = models.DateTimeField(auto_now_add=True)


class Run(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    conversation = models.ForeignKey(Conversation, on_delete=models.PROTECT, related_name='runs')
    request_key = models.UUIDField()
    question = models.TextField()
    # queued -> running -> awaiting_confirmation | done | failed
    # awaiting_confirmation -> execute_queued -> executing -> done | unknown
    status = models.CharField(max_length=30, default='queued', db_index=True)
    answer = models.TextField(blank=True)
    plan = models.JSONField(default=dict)
    proposal = models.JSONField(default=dict)
    evidence = models.JSONField(default=list)
    limitations = models.JSONField(default=list)
    rows = models.JSONField(default=list)
    row_preview = models.JSONField(default=list)
    row_count = models.PositiveIntegerField(default=0)
    account_snapshot = models.JSONField(default=dict)
    csv_data = models.TextField(blank=True)
    pdf = models.BinaryField(null=True, editable=False)
    csv_available = models.BooleanField(default=False)
    pdf_available = models.BooleanField(default=False)
    export_error = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True)
    finished_at = models.DateTimeField(null=True)

    def save(self, *args, **kwargs):
        # Polling reads these small fields without fetching artifacts or all rows.
        # Preserve them when a deferred instance saves unrelated state.
        update_fields = kwargs.get('update_fields')
        changed = set()
        deferred = self.get_deferred_fields()
        if 'rows' not in deferred and (update_fields is None or 'rows' in update_fields):
            self.row_preview, self.row_count = self.rows[:100], len(self.rows)
            changed.update(('row_preview', 'row_count'))
        for artifact in ('csv_data', 'pdf'):
            if artifact not in deferred and (update_fields is None or artifact in update_fields):
                name = 'csv_available' if artifact == 'csv_data' else 'pdf_available'
                setattr(self, name, bool(getattr(self, artifact)))
                changed.add(name)
        if update_fields is not None:
            kwargs['update_fields'] = set(update_fields) | changed
        return super().save(*args, **kwargs)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['conversation', 'request_key'], name='chat_request_once')]
        ordering = ['created_at', 'id']


class Execution(models.Model):
    """Claim before remote I/O; never automatically retry an ambiguous mutation."""
    run = models.OneToOneField(Run, on_delete=models.PROTECT)
    fingerprint = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)


class Audit(models.Model):
    account = models.ForeignKey(Account, on_delete=models.PROTECT)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    run = models.ForeignKey(Run, on_delete=models.PROTECT, null=True)
    event = models.CharField(max_length=80)
    detail = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
