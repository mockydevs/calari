"""
Quick email credential test — run with:
    .venv/Scripts/python test_email.py
"""
import os
import django
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env.dev")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.core.mail import send_mail
from django.conf import settings

TO = os.getenv("EMAIL_HOST_USER")   # sends to yourself as a quick check

print(f"Sending test email to {TO} via {settings.EMAIL_HOST}:{settings.EMAIL_PORT} ...")

try:
    send_mail(
        subject="Calari Portal — Email Test",
        message="If you're reading this, your SMTP credentials are working correctly.",
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[TO],
        fail_silently=False,
    )
    print("✓ Email sent successfully.")
except Exception as e:
    print(f"✗ Failed: {e}")
