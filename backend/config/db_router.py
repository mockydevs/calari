"""Routes the `vectorstore` app (pgvector embeddings) to the separate `vectors`
database, and keeps everything else on `default`. The vector store is optional:
when VECTOR_DATABASE_URL isn't set there is no `vectors` alias, the app simply
isn't migrated, and retrieval falls back to full-text search on the default DB.

No cross-database relations exist — BuildKnowledgeChunk references its source by a
plain integer (knowledge_id), never a ForeignKey across databases.
"""
from django.conf import settings

VECTOR_APP = "vectorstore"
VECTOR_ALIAS = "vectors"


class VectorRouter:
    @staticmethod
    def _has_vectors() -> bool:
        return VECTOR_ALIAS in settings.DATABASES

    def db_for_read(self, model, **hints):
        if model._meta.app_label == VECTOR_APP:
            return VECTOR_ALIAS
        return None

    def db_for_write(self, model, **hints):
        if model._meta.app_label == VECTOR_APP:
            return VECTOR_ALIAS
        return None

    def allow_relation(self, obj1, obj2, **hints):
        labels = {obj1._meta.app_label, obj2._meta.app_label}
        if VECTOR_APP in labels:
            return obj1._meta.app_label == obj2._meta.app_label
        return None

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        if app_label == VECTOR_APP:
            return db == VECTOR_ALIAS and self._has_vectors()
        # Never put non-vector apps on the vectors DB.
        if db == VECTOR_ALIAS:
            return False
        return None
