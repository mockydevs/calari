"""Vector store for semantic Build Library retrieval. Lives in the separate
`vectors` database (pgvector). Deliberately has NO ForeignKey to builds.BuildKnowledge
— that table is in another database — so it references its source by knowledge_id.
"""
from django.db import models
from pgvector.django import VectorField, HnswIndex

EMBED_DIM = 1536  # OpenAI text-embedding-3-small


class BuildKnowledgeChunk(models.Model):
    knowledge_id = models.IntegerField(db_index=True)        # builds.BuildKnowledge.id (other DB)
    client_id = models.IntegerField(null=True, blank=True, db_index=True)
    title = models.CharField(max_length=300, blank=True, default="")
    chunk_index = models.IntegerField(default=0)
    content = models.TextField()
    embedding = VectorField(dimensions=EMBED_DIM)
    use_for_ai = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = "vectorstore"
        indexes = [
            HnswIndex(
                name="bkc_embedding_hnsw",
                fields=["embedding"],
                m=16,
                ef_construction=64,
                opclasses=["vector_cosine_ops"],
            ),
        ]

    def __str__(self):
        return f"chunk[{self.knowledge_id}#{self.chunk_index}] {self.title}"
