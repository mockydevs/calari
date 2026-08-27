"""Opt-in, isolated local development and test settings. Never use in production.

Run with --settings=config.settings_local. Production settings remain unchanged.
The vector database is disabled; GHL AI generation still requires a configured key.
"""
from .settings import *  # noqa: F403

DEBUG = True
FRONTEND_URL = "http://127.0.0.1:3000"
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "local.sqlite3"}}  # noqa: F405
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}
CELERY_TASK_ALWAYS_EAGER = True
CELERY_BROKER_URL = "memory://"
CELERY_RESULT_BACKEND = "cache+memory://"
SECURE_SSL_REDIRECT = False
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False
SIMPLE_JWT = {**SIMPLE_JWT, "AUTH_COOKIE_SECURE": False}  # noqa: F405
