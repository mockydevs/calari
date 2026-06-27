"""
Generate the long-form, step-by-step GoHighLevel IMPLEMENTATION BUILD DOCUMENT for a build
and (optionally) write it to a file to hand to the assigned team member.

This is the implementer-facing companion to the structured blueprint / handover: the full
24-section build doc with every workflow expanded into builder-level steps. It is grounded in
the build's captured blueprint, its original meeting notes, and the Build-Library learning loop.

    python manage.py generate_build_doc <build_id>
    python manage.py generate_build_doc <build_id> --out build-doc.md
    python manage.py generate_build_doc <build_id> --out build-doc.md --with-notes

Costs one AI generation call (uses the configured blueprint/smartest model).
"""
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from builds import services


class Command(BaseCommand):
    help = "Generate the step-by-step GHL build document for a build (optionally write to a file)."

    def add_arguments(self, parser):
        parser.add_argument("build_id", type=int, help="Build primary key.")
        parser.add_argument("--out", type=str, default="", help="Write the document to this Markdown file.")
        parser.add_argument(
            "--with-notes", action="store_true",
            help="Also write the original meeting notes next to --out (so the team member gets both).",
        )

    def handle(self, *args, **options):
        from builds.models import Build

        build = Build.objects.filter(pk=options["build_id"]).first()
        if not build:
            raise CommandError(f"Build {options['build_id']} not found.")

        self.stdout.write(f"Generating build document for: {build.title!r}…")
        try:
            doc = services.generate_build_document(build)
        except Exception as exc:  # noqa: BLE001
            raise CommandError(f"Generation failed: {exc}")

        out = options["out"]
        if not out:
            self.stdout.write(doc)
            return

        out_path = Path(out)
        out_path.write_text(doc, encoding="utf-8")
        self.stdout.write(self.style.SUCCESS(f"Wrote build document → {out_path} ({len(doc):,} chars)"))

        if options["with_notes"]:
            notes = "\n\n".join(
                build.meeting_notes.order_by("created_at").values_list("raw_text", flat=True)
            ) or "_No meeting notes on file._"
            notes_path = out_path.with_name(out_path.stem + ".notes.md")
            notes_path.write_text(
                f"# {build.title} — Original meeting notes\n\n{notes}\n", encoding="utf-8"
            )
            self.stdout.write(self.style.SUCCESS(f"Wrote original notes → {notes_path}"))
