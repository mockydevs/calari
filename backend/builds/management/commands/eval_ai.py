"""Lightweight eval harness — run a gold meeting-notes example through the
source-faithful tasklist extraction and score key quality signals. Run it
before/after a prompt or model change to know whether the change actually helps.

    python manage.py eval_ai

Costs one tasklist-extraction call. Add more gold cases under
docs/handover-system/examples to broaden coverage.
"""
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from builds import services

_NOTES = (
    Path(settings.BASE_DIR).parent / "docs" / "handover-system" / "examples"
    / "dental-patient-acquisition.notes.md"
)

_VALID_SECTIONS = {
    "PIPELINE", "AUTOMATIONS", "CLIENT_UPDATES", "LEAD_SOURCES", "CALENDARS",
    "INTEGRATIONS", "FIELDS_TAGS", "FORMS_PAYMENTS", "REPORTING_LAUNCH", "",
}
_VALID_CATEGORIES = {"REQUEST", "CHANGE", "QUESTION", "DECISION", "INFO"}


class Command(BaseCommand):
    help = "Score source-faithful tasklist extraction on a gold example."

    def handle(self, *args, **options):
        if not _NOTES.exists():
            self.stderr.write(self.style.ERROR(f"Gold example not found: {_NOTES}"))
            return
        notes = _NOTES.read_text(encoding="utf-8")
        self.stdout.write("Extracting tasklist from the gold example…")
        data = services.extract_meeting_tasklist(notes)
        checks = self._score(data)
        passed = sum(1 for ok, _ in checks.values() if ok)
        for name, (ok, detail) in checks.items():
            tag = self.style.SUCCESS("PASS") if ok else self.style.ERROR("FAIL")
            self.stdout.write(f"  [{tag}] {name}: {detail}")
        line = f"Score: {passed}/{len(checks)}"
        self.stdout.write((self.style.SUCCESS if passed == len(checks) else self.style.WARNING)(line))

    @staticmethod
    def _score(d: dict) -> dict:
        items = d.get("items", []) or []
        sections = {i.get("section", "") for i in items}
        categories = {i.get("category", "") for i in items}
        bad_section = [i for i in items if i.get("section") not in _VALID_SECTIONS]
        bad_category = [i for i in items if i.get("category") not in _VALID_CATEGORIES]
        has_text = all((i.get("text") or "").strip() for i in items)
        return {
            "items captured": (len(items) >= 5, f"{len(items)} items"),
            "covers ≥3 GHL sections": (len({s for s in sections if s}) >= 3, f"{sorted(sections)}"),
            "valid section tags": (not bad_section, f"{len(bad_section)} invalid"),
            "valid category tags": (not bad_category, f"{len(bad_category)} invalid"),
            "uses ≥2 categories": (len(categories) >= 2, f"{sorted(categories)}"),
            "every item has text": (has_text, "ok" if has_text else "blank items found"),
        }
