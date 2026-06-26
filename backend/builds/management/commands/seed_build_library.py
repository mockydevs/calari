"""
Seed the Build Library with Calari's gold-standard reference material so the AI blueprint
generator has something to learn from.

The generator's learning loop (`builds.services.build_reference_context`) only pulls
`BuildKnowledge` rows where `use_for_ai=True`. On a fresh install that table is empty, so
generation gets no "how Calari builds" context. This command loads redacted references from
docs/handover-system/examples as GENERAL library docs (not tied to a client):

  1. A full worked dental patient-acquisition build (Patient Prism + Modento + GHL).
  2. A cross-vertical build-patterns playbook distilled from the wider portfolio
     (speed-to-lead, nurture, appointment lifecycle, reporting pipelines, app sync, and the
     A2P / SMS compliance workstream that most often blocks go-live).

Idempotent: matched by title. Re-run to ensure presence; pass --force to overwrite the
stored text/summary even if a human has edited it since.

    python manage.py seed_build_library
    python manage.py seed_build_library --force
"""
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

# docs/ lives at the repo root, one level above the Django BASE_DIR (the backend/ dir).
_EXAMPLES_DIR = Path(settings.BASE_DIR).parent / "docs" / "handover-system" / "examples"


# Each reference: a stable title (used for idempotent matching), the example file to load as
# raw_text, and a short dense summary the generator sees first (build_reference_context prefers
# `summary`, then falls back to raw_text).
REFERENCES = [
    {
        "title": "Reference build — Dental patient-acquisition (Patient Prism + Modento + GHL)",
        "file": _EXAMPLES_DIR / "dental-patient-acquisition.handover.md",
        "fallback_file": _EXAMPLES_DIR / "dental-patient-acquisition.notes.md",
        "summary": (
            "Single GHL pipeline as the source of truth for a dental practice, fed by four sources: "
            "website forms (-> New Lead - Unqualified), Patient Prism reload leads via a daily Contacts-API "
            "cron that adds the tag 'new-opportunity' (relo workflow triggers on TAG ADDED, not contact-created; "
            "-> Qualified Lead with alert + task + synced dollar value), Patient Prism call events via inbound "
            "webhook (route by tag), and Modento online bookings via a secret-validated GTM webhook (-> Appointment "
            "Booked; record-keeping only). Stages: New Lead - Unqualified, Qualified Lead, Appointment Booked, "
            "Scheduled, First Appointment Completed, 3-Month Value Completed, Spam, Lost. Stages 1-5 auto-advance "
            "on reliable signals; 3-Month Value and Lost are manual. Workflow code convention: A active conversion, "
            "IN intake/routing, REC record-keeping, E/K appointment lifecycle, G post-visit, H/X/Y/Z internal/utility. "
            "A global exits/suppression workflow removes booked/qualified/do-not-contact leads from nurtures. Dedup "
            "email-first-then-phone. Common gaps: blank google_reviews_link and referral_incentive_amount, confirm "
            "online booking applies a suppression tag, relo cron cadence vs the ~10-min expectation, and which Meta "
            "conversion events to send for sales-qualified-lead ad optimization."
        ),
    },
    {
        "title": "Reference patterns — Calari cross-vertical build playbook (incl. A2P/SMS compliance)",
        "file": _EXAMPLES_DIR / "calari-build-patterns.md",
        "fallback_file": None,
        "summary": (
            "Recurring deliverables across Calari builds (dental, med-spa, recruitment, home services, auto, "
            "events, app integrations). Workflows an expert always includes: speed-to-lead auto-reply (email+SMS) "
            "within ~5 min + internal alert to the ASSIGNED rep + follow-up task; lead-source router/tagging; "
            "lead-value calculator from a budget field; unqualified vs qualified nurtures that suppress on booking; "
            "appointment confirmation + reminders (24h + 1-2h) + no-show recovery + reschedule flow that clears "
            "stale reminders; post-visit review/referral; pipeline-stage movers; embedded AI eligibility "
            "qualification. Integrations: bidirectional GHL<->client app sync (appointments, estimates, invoices, "
            "status); GTM->GHL webhook bridge when a scheduler has no native integration; reporting pipelines "
            "(source -> daily Google Sheet -> scorecards) noting sync latency and rounding variance; Meta/Google "
            "conversion APIs. A2P/SMS COMPLIANCE is the most common go-live blocker and is mandatory whenever SMS is "
            "sent: compliant Privacy Policy + Terms (with the verbatim non-sharing clause), unchecked opt-in consent "
            "flow (optional phone, STOP/HELP, rates apply, consent-not-required), Twilio brand+campaign under the "
            "Customer Care/transactional use case. Known failures to plan for: error 30896 opt-in (promotional site "
            "conflicts with a transactional campaign -> build a standalone compliance website, may require brand "
            "deletion/reset); toll-free numbers will NOT connect to GHL (use a LOCAL number). Hygiene: sticky/dedup "
            "contacts, two-way calendar sync, correct email sender identity (no blank merge tags)."
        ),
    },
]


class Command(BaseCommand):
    help = "Seed the Build Library with Calari's gold-standard references (for the AI learning loop)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Overwrite each reference doc's stored text/summary even if it already exists.",
        )

    def handle(self, *args, **options):
        from builds.models import BuildKnowledge

        force = options["force"]
        for ref in REFERENCES:
            raw_text = self._read(ref["file"]) or self._read(ref.get("fallback_file")) or ref["summary"]
            if not self._read(ref["file"]):
                self.stdout.write(self.style.WARNING(
                    f"Example file not found at {ref['file']}; seeding {ref['title']!r} from fallback text."
                ))

            defaults = {
                "raw_text": raw_text,
                "summary": ref["summary"],
                "use_for_ai": True,
                "client": None,
                "build": None,
                "filename": Path(ref["file"]).name,
            }

            obj = BuildKnowledge.objects.filter(title=ref["title"]).first()
            if obj is None:
                BuildKnowledge.objects.create(title=ref["title"], **defaults)
                self.stdout.write(self.style.SUCCESS(f"Created: {ref['title']!r}"))
            elif force:
                for key, value in defaults.items():
                    setattr(obj, key, value)
                obj.save()
                self.stdout.write(self.style.SUCCESS(f"Updated (forced): {ref['title']!r}"))
            else:
                changed = False
                if not obj.use_for_ai:
                    obj.use_for_ai, changed = True, True
                if not (obj.raw_text or obj.summary):
                    obj.raw_text, obj.summary, changed = raw_text, ref["summary"], True
                if changed:
                    obj.save(update_fields=["use_for_ai", "raw_text", "summary"])
                note = "ensured use_for_ai=True" if changed else "already present (use --force to refresh)"
                self.stdout.write(self.style.SUCCESS(f"Exists: {ref['title']!r} — {note}"))

        self.stdout.write(self.style.SUCCESS(f"Build Library seed complete ({len(REFERENCES)} reference(s))."))

    @staticmethod
    def _read(path) -> str:
        if not path:
            return ""
        try:
            return Path(path).read_text(encoding="utf-8").strip()
        except OSError:
            return ""
