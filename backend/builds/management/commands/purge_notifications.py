"""Delete old, already-read notifications so the table doesn't grow forever.

  python manage.py purge_notifications --days 30

Wire to a daily schedule via django-celery-beat (DatabaseScheduler is already running)
or cron. Only READ notifications past the cutoff are removed; unread are kept.
"""
from django.core.management.base import BaseCommand
from django.utils import timezone

from builds.models import Notification


class Command(BaseCommand):
    help = "Purge read notifications older than N days (default 30)."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=30)

    def handle(self, *args, **options):
        days = max(1, options["days"])
        cutoff = timezone.now() - timezone.timedelta(days=days)
        deleted, _ = Notification.objects.filter(read=True, created_at__lt=cutoff).delete()
        self.stdout.write(self.style.SUCCESS(f"Purged {deleted} read notification(s) older than {days}d."))
