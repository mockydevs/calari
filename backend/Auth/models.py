from django.contrib.auth.models import AbstractUser
from django.db import models
import uuid
from django.utils import timezone
from datetime import timedelta


class DashboardUser(AbstractUser):
    ROLE_CHOICES = [
        ('superuser', 'Superuser'),
        ('admin', 'Admin'),
        ('employee', 'Employee'),
        ('finance', 'Finance'),
    ]
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='employee')
    full_name = models.CharField(max_length=255, blank=True)
    job_title = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True)
    last_login_ip = models.GenericIPAddressField(null=True, blank=True)
    profile_notes = models.TextField(blank=True)
    # Per-member feature grants. Admins/superusers implicitly have every feature;
    # for employees this list opts them into specific admin-area features (a2p,
    # clients, builds_manage, team, ai_keys). See FEATURE_KEYS / has_feature().
    feature_permissions = models.JSONField(default=list, blank=True)

    class Meta:
        db_table = 'auth_dashboarduser'

    def __str__(self):
        return self.email or self.username

    @property
    def display_name(self):
        return self.full_name or self.username

    @property
    def is_superuser_role(self):
        return self.role == 'superuser' or self.is_superuser

    @property
    def is_manager(self):
        return bool(self.is_superuser or self.role in ('superuser', 'admin'))

    def has_feature(self, key):
        """True if this user can use feature `key`. Managers have all features;
        employees must be granted the feature explicitly."""
        if self.is_manager:
            return True
        return key in (self.feature_permissions or [])


# Feature keys an admin can grant to an individual member.
FEATURE_KEYS = ['a2p', 'clients', 'builds_manage', 'team', 'ai_keys']


class PasswordResetToken(models.Model):
    user = models.ForeignKey(
        DashboardUser,
        on_delete=models.CASCADE,
        related_name='password_reset_tokens',
    )
    token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used = models.BooleanField(default=False)

    class Meta:
        db_table = 'auth_passwordresettoken'

    def save(self, *args, **kwargs):
        if not self.expires_at:
            self.expires_at = timezone.now() + timedelta(hours=1)
        super().save(*args, **kwargs)

    @property
    def is_valid(self):
        return not self.used and timezone.now() < self.expires_at

    def __str__(self):
        return f"PasswordResetToken({self.user.username}, used={self.used})"
