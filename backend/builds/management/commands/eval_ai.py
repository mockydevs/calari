"""Lightweight eval harness — run a gold meeting-notes example through blueprint
generation and score key quality signals. Run it before/after a prompt or model
change to know whether the change actually helps (instead of guessing).

    python manage.py eval_ai

Costs one blueprint generation call. Add more gold cases under
docs/handover-system/examples to broaden coverage.
"""
import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from builds import services

_NOTES = (
    Path(settings.BASE_DIR).parent / "docs" / "handover-system" / "examples"
    / "dental-patient-acquisition.notes.md"
)


class Command(BaseCommand):
    help = "Score blueprint generation quality on a gold example."

    def handle(self, *args, **options):
        if not _NOTES.exists():
            self.stderr.write(self.style.ERROR(f"Gold example not found: {_NOTES}"))
            return
        notes = _NOTES.read_text(encoding="utf-8")
        self.stdout.write("Generating blueprint from the gold example…")
        draft = services.generate_blueprint_draft(notes)
        checks = self._score(draft)
        passed = sum(1 for ok, _ in checks.values() if ok)
        for name, (ok, detail) in checks.items():
            tag = self.style.SUCCESS("PASS") if ok else self.style.ERROR("FAIL")
            self.stdout.write(f"  [{tag}] {name}: {detail}")
        line = f"Score: {passed}/{len(checks)}"
        self.stdout.write((self.style.SUCCESS if passed == len(checks) else self.style.WARNING)(line))

    @staticmethod
    def _score(d: dict) -> dict:
        stages = d.get("pipelineStages", []) or []
        workflows = d.get("workflows", []) or []
        prelaunch = d.get("preLaunchItems", []) or []
        gaps = d.get("gaps", []) or []
        lead_sources = d.get("leadSources", []) or []
        integrations = d.get("externalIntegrations", []) or []
        transitions = d.get("stageTransitions", []) or []
        text = json.dumps(d).lower()
        sms = "sms" in text or "twilio" in text
        a2p = any(
            kw in (p.get("description", "") or "").lower()
            for p in prelaunch for kw in ("a2p", "consent", "twilio", "opt-in", "privacy")
        )
        return {
            "named pipeline stages": (len(stages) >= 3, f"{len(stages)} stages"),
            "stage transitions": (len(transitions) >= 2, f"{len(transitions)} transitions"),
            "named workflows": (len(workflows) >= 4, f"{len(workflows)} workflows"),
            "lead sources captured": (len(lead_sources) >= 1, f"{len(lead_sources)}"),
            "external integrations": (len(integrations) >= 1, f"{len(integrations)}"),
            "gaps raised": (len(gaps) >= 1, f"{len(gaps)}"),
            "pre-launch checklist": (len(prelaunch) >= 1, f"{len(prelaunch)} items"),
            "A2P/SMS compliance when SMS present": (a2p if sms else True, f"sms={sms} a2p_items={a2p}"),
        }
