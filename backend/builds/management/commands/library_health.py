"""Build Library health — coverage report, embedding re-index, and enrichment backfill.

    python manage.py library_health                 # coverage report only
    python manage.py library_health --reindex        # + re-embed every use_for_ai doc
    python manage.py library_health --enrich-missing  # + queue AI enrichment for un-summarized docs

Run --reindex after changing OPENAI_EMBED_MODEL (mixed embedding spaces silently corrupt
similarity). Coverage flags GHL sections with thin gold-exemplar coverage so the team
knows what to upload next.
"""
from collections import Counter

from django.core.management.base import BaseCommand

from builds import services
from builds.models import BuildKnowledge, BuildSection, KnowledgeQuality

_MIN_GOLD_PER_SECTION = 2  # below this, a section is flagged as under-covered


class Command(BaseCommand):
    help = "Build Library coverage report, re-embed, and enrichment backfill."

    def add_arguments(self, parser):
        parser.add_argument("--reindex", action="store_true",
                            help="Re-embed every use_for_ai doc (run after changing the embedding model).")
        parser.add_argument("--enrich-missing", action="store_true",
                            help="Queue AI enrichment for docs missing a summary.")

    def handle(self, *args, **options):
        qs = BuildKnowledge.objects.filter(use_for_ai=True)
        total = qs.count()
        self.stdout.write(self.style.MIGRATE_HEADING(f"Build Library - {total} active doc(s)"))
        self.stdout.write(f"Embedding model: {services.EMBED_MODEL} | vectors enabled: {services._vectors_enabled()}")

        by_quality = Counter()
        section_gold = Counter()
        section_any = Counter()
        enriched = 0
        for kn in qs.only("quality", "ghl_sections", "summary"):
            by_quality[kn.quality] += 1
            if (kn.summary or "").strip():
                enriched += 1
            for sec in (kn.ghl_sections or []):
                section_any[sec] += 1
                if kn.quality == KnowledgeQuality.GOLD:
                    section_gold[sec] += 1

        self.stdout.write("\nBy quality:")
        for q, _label in KnowledgeQuality.choices:
            self.stdout.write(f"  {q:<9} {by_quality.get(q, 0)}")
        self.stdout.write(f"\nEnriched (has summary): {enriched}/{total}")

        self.stdout.write("\nGHL section coverage (gold / any):")
        thin = []
        for sec, label in BuildSection.choices:
            g, a = section_gold.get(sec, 0), section_any.get(sec, 0)
            flag = "" if g >= _MIN_GOLD_PER_SECTION else self.style.WARNING("  <- thin")
            self.stdout.write(f"  {label:<24} {g} / {a}{flag}")
            if g < _MIN_GOLD_PER_SECTION:
                thin.append(label)
        if thin:
            self.stdout.write(self.style.WARNING(
                f"\nUnder-covered sections (upload gold exemplars): {', '.join(thin)}"))

        if options["enrich_missing"]:
            from builds.tasks import enrich_knowledge
            missing = list(qs.filter(summary="").values_list("id", flat=True))
            for kid in missing:
                enrich_knowledge.delay(kid)
            self.stdout.write(self.style.SUCCESS(f"\nQueued enrichment for {len(missing)} doc(s)."))

        if options["reindex"]:
            self.stdout.write("\nRe-embedding all active docs…")
            chunks = 0
            for kn in qs:
                try:
                    chunks += services.index_knowledge(kn)
                except Exception as e:  # noqa: BLE001 — keep going; report at the end
                    self.stderr.write(self.style.ERROR(f"  {kn.id} {kn.title}: {e}"))
            self.stdout.write(self.style.SUCCESS(f"Re-embedded {total} doc(s) → {chunks} chunk(s)."))
