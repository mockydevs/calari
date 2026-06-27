"""Onboarding Intelligence pipeline (Celery).

Fireflies call → fetch transcript → resolve client → AI insight → idempotent fan-out
to Asana / Slack (internal + external) / Google Drive. Fully automated, with the
guardrails from AutomationSettings (kill switch, confidence floor, external toggle,
guardrail pass). Every outbound action is an idempotent, retried IntegrationEvent.
"""
from datetime import datetime, timezone as _tz

from celery import shared_task
from django.db import transaction

from . import services, integrations
from .integrations import IntegrationError
from .models import (
    AutomationSettings, CallInsight, CallInsightStatus, IntegrationEvent,
    EventTarget, EventStatus,
)


# ─── helpers ────────────────────────────────────────────────────────────────
def _alert_ops(message: str) -> None:
    """Best-effort heads-up to the ops Slack channel; never raises."""
    try:
        settings = AutomationSettings.load()
        if settings.ops_alert_channel_id:
            integrations.slack_post(settings.ops_alert_channel_id, f":robot_face: {message}")
    except Exception:  # noqa: BLE001
        pass


def _parse_date(value):
    if value is None:
        return None
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value / 1000 if value > 1e12 else value, tz=_tz.utc)
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:  # noqa: BLE001
        return None


def _prior_context(client_id, exclude_call_id) -> str:
    if not client_id:
        return ""
    prior = (CallInsight.objects
             .filter(client_id=client_id).exclude(fireflies_call_id=exclude_call_id)
             .exclude(summary="").order_by("-created_at")[:5])
    return "\n".join(f"- {p.title or p.created_at:%Y-%m-%d}: {p.summary}" for p in prior)


def _emit(insight: CallInsight, target: str, do_fn, *, skip_reason: str | None = None):
    """Idempotent outbound action. dedupe_key makes re-delivery safe; a failure on one
    target never blocks the others. do_fn() returns (external_ref, payload_snapshot)."""
    key = f"{insight.fireflies_call_id}:{target}"
    ev, _ = IntegrationEvent.objects.get_or_create(
        dedupe_key=key, defaults={"call_insight": insight, "target": target},
    )
    if ev.status == EventStatus.SENT:
        return ev
    if skip_reason:
        ev.status = EventStatus.SKIPPED
        ev.error = skip_reason
        ev.save(update_fields=["status", "error", "updated_at"])
        return ev
    ev.attempts += 1
    try:
        ref, payload = do_fn()
        ev.status = EventStatus.SENT
        ev.external_ref = (ref or "")[:255]
        ev.payload_snapshot = payload
        ev.error = ""
    except Exception as e:  # noqa: BLE001
        ev.status = EventStatus.FAILED
        ev.error = str(e)[:1000]
    ev.save(update_fields=["status", "external_ref", "payload_snapshot", "error", "attempts", "updated_at"])
    return ev


# ─── main pipeline ────────────────────────────────────────────────────────────
@shared_task(bind=True, max_retries=2, default_retry_delay=30)
def ingest_fireflies_call(self, call_id, payload=None):
    """Entry point dispatched by the Fireflies webhook."""
    settings = AutomationSettings.load()
    if not settings.enabled:
        return  # global kill switch

    existing = CallInsight.objects.filter(fireflies_call_id=call_id).first()
    if existing and existing.status not in (CallInsightStatus.PENDING, CallInsightStatus.FAILED):
        return  # already processed (idempotent on re-delivery)

    # 1. Fetch transcript.
    try:
        tr = integrations.fireflies_transcript(call_id)
    except IntegrationError as e:
        ci = existing or CallInsight(fireflies_call_id=call_id)
        ci.status = CallInsightStatus.FAILED
        ci.save()
        _alert_ops(f"Fireflies fetch failed for call `{call_id}`: {e}")
        return

    emails = [p.get("email") for p in tr.get("participants", []) if p.get("email")]
    client_map = services.resolve_client_map(emails)

    # 2. Persist the call shell.
    ci, _ = CallInsight.objects.update_or_create(
        fireflies_call_id=call_id,
        defaults={
            "client_id": client_map.client_id if client_map else None,
            "title": tr.get("title", ""),
            "call_date": _parse_date(tr.get("date")),
            "participants": tr.get("participants", []),
            "transcript_url": tr.get("url", ""),
            "raw_transcript": tr.get("text", ""),
            "status": CallInsightStatus.PROCESSING,
        },
    )

    # 3. Attribution gate.
    if not client_map:
        ci.status = CallInsightStatus.SKIPPED
        ci.save(update_fields=["status", "updated_at"])
        _alert_ops(f"Could not attribute call *{ci.title or call_id}* to a client — review needed.")
        return
    if not client_map.active:
        ci.status = CallInsightStatus.SKIPPED
        ci.save(update_fields=["status", "updated_at"])
        return

    # 4. AI insight.
    try:
        insight = services.analyze_call(
            tr.get("text", ""),
            client_name=client_map.client.name if client_map.client_id else "",
            prior_context=_prior_context(ci.client_id, call_id),
        )
    except Exception as e:  # noqa: BLE001
        ci.status = CallInsightStatus.FAILED
        ci.save(update_fields=["status", "updated_at"])
        _alert_ops(f"AI analysis failed for call *{ci.title or call_id}*: {e}")
        return

    ci.summary = (insight.get("summary") or "")[:8000]
    ci.insight = insight
    ci.confidence = _as_confidence(insight.get("confidence"))
    ci.ai_model = services.ai._blueprint_model()
    ci.status = CallInsightStatus.ANALYZED
    ci.save(update_fields=["summary", "insight", "confidence", "ai_model", "status", "updated_at"])

    # 5. Fan out.
    _fan_out(ci, client_map, insight, settings, transcript_len=len(tr.get("text", "")))
    ci.status = CallInsightStatus.DISTRIBUTED
    ci.save(update_fields=["status", "updated_at"])


# A transcript shorter than this is too thin to trust for a client-facing post.
_MIN_EXTERNAL_TRANSCRIPT_CHARS = 400


def _as_confidence(value) -> float | None:
    """Coerce the model's self-reported confidence to a 0..1 float, or None."""
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(1.0, f))


def _fan_out(ci: CallInsight, m, insight: dict, settings: AutomationSettings, transcript_len: int = 0):
    # ── Slack internal (always) ──
    internal = (insight.get("internal_summary") or insight.get("summary") or "").strip()
    if m.slack_internal_channel_id and internal:
        _emit(ci, EventTarget.SLACK_INTERNAL,
              lambda: (integrations.slack_post(m.slack_internal_channel_id, _slack_text(ci, internal)), {"channel": m.slack_internal_channel_id}))

    # ── Asana tasks ──
    action_items = insight.get("action_items") or []
    if m.asana_project_gid and action_items:
        def _make_tasks():
            gids = []
            for it in action_items:
                name = (it.get("title") or "").strip()
                if not name:
                    continue
                gids.append(integrations.asana_create_task(m.asana_project_gid, name, it.get("detail", "")))
            return ",".join(g for g in gids if g), {"count": len(gids)}
        _emit(ci, EventTarget.ASANA, _make_tasks)

    # ── Google Drive doc enrichment ──
    if m.drive_onboarding_doc_id:
        block = _drive_block(ci, insight)
        _emit(ci, EventTarget.DRIVE,
              lambda: (integrations.gdocs_append(m.drive_onboarding_doc_id, block), {"doc": m.drive_onboarding_doc_id}))

    # ── Slack external (client-facing) — guardrailed ──
    external = (insight.get("external_summary") or "").strip()
    if m.slack_external_channel_id and external:
        if not settings.external_posting_enabled:
            _emit(ci, EventTarget.SLACK_EXTERNAL, None, skip_reason="External posting disabled globally.")
        elif transcript_len < _MIN_EXTERNAL_TRANSCRIPT_CHARS:
            _emit(ci, EventTarget.SLACK_EXTERNAL, None,
                  skip_reason=f"Transcript too short ({transcript_len} chars) to post to the client.")
            _alert_ops(f"External summary held (thin transcript) for *{ci.title}* — review.")
        elif (ci.confidence or 0) < settings.confidence_threshold:
            _emit(ci, EventTarget.SLACK_EXTERNAL, None,
                  skip_reason=f"Confidence {ci.confidence} below threshold {settings.confidence_threshold}.")
            _alert_ops(f"External summary held (low confidence) for *{ci.title}* — review.")
        else:
            verdict = services.guardrail_check(external)
            if not verdict.get("ok"):
                _emit(ci, EventTarget.SLACK_EXTERNAL, None, skip_reason=f"Guardrail: {verdict.get('reason', '')}")
                _alert_ops(f"External summary blocked by guardrail for *{ci.title}*: {verdict.get('reason', '')}")
            else:
                _emit(ci, EventTarget.SLACK_EXTERNAL,
                      lambda: (integrations.slack_post(m.slack_external_channel_id, external), {"channel": m.slack_external_channel_id}))


def _slack_text(ci: CallInsight, body: str) -> str:
    head = f"*Onboarding call recap — {ci.title or 'call'}*"
    link = f"\n<{ci.transcript_url}|View transcript>" if ci.transcript_url else ""
    return f"{head}\n{body}{link}"


def _drive_block(ci: CallInsight, insight: dict) -> str:
    when = ci.call_date.strftime("%Y-%m-%d") if ci.call_date else ""
    lines = [f"\n\n— Call context ({when}) — {ci.title} —\n", (insight.get("summary") or "")]
    needs = insight.get("needs") or []
    if needs:
        lines.append("\nNeeds: " + "; ".join(needs))
    actions = [a.get("title", "") for a in (insight.get("action_items") or [])]
    if actions:
        lines.append("\nAction items: " + "; ".join(a for a in actions if a))
    return "\n".join(lines) + "\n"


# ─── Retraction ───────────────────────────────────────────────────────────────
@shared_task(bind=True, max_retries=1)
def retract_event(self, event_id):
    """Undo a posted action: delete the Slack message / Asana task; mark retracted."""
    ev = IntegrationEvent.objects.select_related("call_insight").filter(pk=event_id).first()
    if not ev or ev.status != EventStatus.SENT or not ev.external_ref:
        return
    m = getattr(ev.call_insight.client, "integration_map", None) if ev.call_insight.client_id else None
    try:
        if ev.target == EventTarget.SLACK_INTERNAL and m:
            integrations.slack_delete(m.slack_internal_channel_id, ev.external_ref)
        elif ev.target == EventTarget.SLACK_EXTERNAL and m:
            integrations.slack_delete(m.slack_external_channel_id, ev.external_ref)
        elif ev.target == EventTarget.ASANA:
            for gid in ev.external_ref.split(","):
                if gid.strip():
                    integrations.asana_delete_task(gid.strip())
        # Drive appends are not auto-retracted (manual edit).
        ev.status = EventStatus.RETRACTED
        ev.save(update_fields=["status", "updated_at"])
    except Exception:  # noqa: BLE001
        pass
