from datetime import timedelta
from celery import shared_task
from django.utils import timezone

from .models import Run
from .services import audit, process_run


@shared_task(soft_time_limit=200, time_limit=220, acks_late=False)
def drain_chat():
    # Durable DB queue: HTTP handlers never call Celery.delay (which can run
    # inline under development's eager setting). Beat and workers own all I/O.
    cutoff = timezone.now() - timedelta(minutes=5)
    for run in Run.objects.filter(status__in=['running', 'executing'], started_at__lt=cutoff).select_related('conversation')[:20]:
        status = 'unknown' if run.status == 'executing' else 'failed'
        if Run.objects.filter(pk=run.pk, status=run.status).update(status=status, finished_at=timezone.now(),
                answer='Worker stopped before completion. Do not repeat mutations; reconcile the account and audit trail first.'):
            audit(run, 'worker_interrupted')
    run_id = Run.objects.filter(status__in=['queued', 'execute_queued']).order_by('created_at').values_list('pk', flat=True).first()
    if run_id:
        process_run(run_id)
