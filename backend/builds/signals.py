"""Keep the pgvector store in sync with the Build Library. On any BuildKnowledge
create/update we (re)embed its chunks; on delete we drop them. Indexing runs in
Celery so uploads/saves never block on the embeddings API, and a broker outage
never breaks the save."""
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver

from .models import BuildKnowledge


@receiver(post_save, sender=BuildKnowledge)
def _reindex_knowledge(sender, instance, **kwargs):
    from .tasks import reindex_knowledge
    try:
        reindex_knowledge.delay(instance.id)
    except Exception:  # noqa: BLE001 — broker down must not break the save
        pass


@receiver(post_delete, sender=BuildKnowledge)
def _remove_knowledge(sender, instance, **kwargs):
    from .tasks import remove_knowledge_chunks
    try:
        remove_knowledge_chunks.delay(instance.id)
    except Exception:  # noqa: BLE001
        pass
