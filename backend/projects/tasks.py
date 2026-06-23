from celery import shared_task
from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.utils.html import strip_tags


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def send_notification_email(self, recipient_email, subject, context):
    try:
        html = render_to_string('email/notification.html', context)
        plain = strip_tags(html)
        send_mail(
            subject,
            plain,
            settings.DEFAULT_FROM_EMAIL,
            [recipient_email],
            html_message=html,
            fail_silently=False,
        )
    except Exception as exc:
        raise self.retry(exc=exc)
