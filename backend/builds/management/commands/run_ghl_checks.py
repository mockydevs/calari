"""Small local worker; production uses the existing Celery beat schedule."""
import time
from django.core.management.base import BaseCommand, CommandError
from django.conf import settings


class Command(BaseCommand):
    help = "Run completion checks locally using isolated settings; production uses Celery."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true")

    def handle(self, *args, **options):
        if settings.SETTINGS_MODULE != "config.settings_local":
            raise CommandError("Use --settings=config.settings_local. Production checks run through Celery.")
        from builds.ghl_verification import drain
        from django.db import close_old_connections
        try:
            while True:
                close_old_connections()
                count = drain()
                if count:
                    self.stdout.write(f"Processed {count} completion check(s).")
                if options["once"]:
                    return
                time.sleep(15)
        except KeyboardInterrupt:
            return
