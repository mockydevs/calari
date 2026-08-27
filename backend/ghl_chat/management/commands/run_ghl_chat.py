"""Explicit local worker; never run slow GHL/AI jobs inside HTTP requests."""
import time

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections

from ghl_chat.tasks import drain_chat


class Command(BaseCommand):
    help = "Process local GHL chat jobs (production uses Celery worker and beat)."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true")

    def handle(self, *args, **options):
        if settings.SETTINGS_MODULE != "config.settings_local":
            raise CommandError("Use --settings=config.settings_local. Production must use Celery worker and beat.")
        try:
            while True:
                close_old_connections()
                drain_chat()
                if options["once"]:
                    return
                time.sleep(3)
        except KeyboardInterrupt:
            self.stdout.write("GHL chat worker stopped.")
        finally:
            close_old_connections()
