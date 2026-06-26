from django.apps import AppConfig


class BuildsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'builds'

    def ready(self):
        from . import signals  # noqa: F401 — connect BuildKnowledge (re)index signals
