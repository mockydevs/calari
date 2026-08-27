import time
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from onboarding.investigations import drain, purge_expired


class Command(BaseCommand):
    help = "Run the local client-context worker (production uses Celery beat)."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true")

    def handle(self, *args, **options):
        if settings.SETTINGS_MODULE != "config.settings_local":
            raise CommandError("Use config.settings_local. Production must use the scheduled worker.")
        last_purge = 0
        while True:
            if time.monotonic() - last_purge > 3600:
                purge_expired()
                last_purge = time.monotonic()
            self.stdout.write(f"Processed {drain()} investigation(s).")
            if options["once"]:
                return
            time.sleep(15)
