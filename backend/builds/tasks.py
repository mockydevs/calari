"""Background tasks for the Builds domain (OpenAI brief generation, etc.)."""
from celery import shared_task
from django.contrib.auth import get_user_model
from django.db import models, transaction

from . import services
from .models import (
    Build, Task, BuildMemorySnapshot, Activity,
    ChangeRequest, MeetingNote, MeetingActionItem, ProgressReport,
)
from .serializers import _user_name

User = get_user_model()


def _run_qa_snapshot(build, user):
    """Run the AI QA review and persist it as a memory snapshot + activity."""
    result = services.run_brief_qa(build)
    issues = result.get("issues", [])
    lines = "\n".join(
        f"[{(i.get('severity') or '').upper()}] {i.get('area', '')}: {i.get('issue', '')}" for i in issues
    ) or "No gaps found — the task list covers the brief."
    BuildMemorySnapshot.objects.create(
        build=build, created_by=user, created_by_ai=True,
        summary=f"AI QA: {result.get('summary', '')}".strip(),
        scope_changes=lines,
    )
    Activity.objects.create(
        build=build,
        actor=_user_name(user) or "system",
        message="AI QA review completed.",
    )


@shared_task(bind=True, max_retries=1, default_retry_delay=15)
def run_build_qa(self, build_id, user_id):
    """AI QA review of a build's brief vs its task list; persists a snapshot."""
    build = Build.objects.filter(pk=build_id).first()
    if not build:
        return
    user = User.objects.filter(pk=user_id).first()
    try:
        _run_qa_snapshot(build, user)
    except Exception:  # noqa: BLE001
        return


@shared_task(bind=True, max_retries=2, default_retry_delay=30)
def reindex_knowledge(self, knowledge_id):
    """(Re)embed a Build Library doc into the pgvector store. No-op if vectors aren't
    configured. Retries on transient embedding/API errors."""
    from .models import BuildKnowledge
    kn = BuildKnowledge.objects.filter(pk=knowledge_id).first()
    if not kn:
        services.delete_knowledge_chunks(knowledge_id)
        return
    try:
        services.index_knowledge(kn)
    except Exception as exc:  # noqa: BLE001
        raise self.retry(exc=exc)


@shared_task
def remove_knowledge_chunks(knowledge_id):
    services.delete_knowledge_chunks(knowledge_id)


@shared_task
def notify_due_builds():
    """Daily SLA watcher: notify the assignee (and creator) about builds that are overdue
    or due within 2 days. Skips delivered builds. Nothing watched due dates before —
    builds just sat past their due_date silently."""
    from datetime import timedelta
    from django.utils import timezone
    from .views import _notify          # lazy import — avoids an import cycle
    from .models import BuildStatus

    now = timezone.now()
    soon = now + timedelta(days=2)
    active = (Build.objects.filter(due_date__isnull=False)
              .exclude(status=BuildStatus.DELIVERED)
              .select_related("assignee", "creator"))

    overdue = list(active.filter(due_date__lt=now))
    upcoming = list(active.filter(due_date__gte=now, due_date__lte=soon))

    for b in overdue:
        days = max(1, (now - b.due_date).days)
        msg = f'Build "{b.title}" is overdue by {days} day{"s" if days != 1 else ""}.'
        _notify(b.assignee, "BUILD_OVERDUE", msg, f"/builds/{b.id}", build_name=b.title)
        if b.creator_id and b.creator_id != b.assignee_id:
            _notify(b.creator, "BUILD_OVERDUE", msg, f"/builds/{b.id}", build_name=b.title)
    for b in upcoming:
        msg = f'Build "{b.title}" is due {b.due_date.strftime("%b %d")}.'
        _notify(b.assignee, "BUILD_DUE_SOON", msg, f"/builds/{b.id}", build_name=b.title)

    return {"overdue": len(overdue), "due_soon": len(upcoming)}


@shared_task(bind=True, max_retries=1, default_retry_delay=20)
def enrich_knowledge(self, knowledge_id):
    """AI-enrich a Build Library doc on upload: fill the retrieval summary + structured
    metadata (niche / build_type / ghl_sections / integrations). Only fills BLANK fields
    so it never clobbers human edits. Saving triggers the reindex signal, so the chunks
    re-embed off the better summary automatically."""
    from django.utils import timezone
    from .models import BuildKnowledge
    kn = BuildKnowledge.objects.filter(pk=knowledge_id).first()
    if not kn:
        return
    try:
        data = services.summarize_knowledge(kn.title, kn.raw_text)
    except Exception as exc:  # noqa: BLE001 — transient API error → retry once
        raise self.retry(exc=exc)
    if not data:
        return
    fields = []
    if data.get("summary") and not kn.summary.strip():
        kn.summary = data["summary"].strip()[:8000]
        fields.append("summary")
    if data.get("niche") and not kn.niche.strip():
        kn.niche = data["niche"].strip()[:120]
        fields.append("niche")
    if data.get("build_type") and not kn.build_type.strip():
        kn.build_type = data["build_type"].strip()[:120]
        fields.append("build_type")
    if data.get("ghl_sections") and not kn.ghl_sections:
        kn.ghl_sections = data["ghl_sections"][:12]
        fields.append("ghl_sections")
    if data.get("integrations") and not kn.integrations.strip():
        kn.integrations = data["integrations"].strip()[:300]
        fields.append("integrations")
    kn.enriched_at = timezone.now()
    fields.append("enriched_at")
    kn.save(update_fields=fields)


@shared_task(bind=True, max_retries=1, default_retry_delay=15)
def generate_task_sop(self, task_id):
    """Generate a step-by-step SOP for a build task and save it as the description."""
    task = Task.objects.filter(pk=task_id).select_related("build").first()
    if not task:
        return
    try:
        sop = services.generate_task_sop(task)
    except Exception:  # noqa: BLE001
        return
    task.description = sop
    task.save(update_fields=["description", "updated_at"])


@shared_task(bind=True, max_retries=1, default_retry_delay=15)
def apply_progress_update(self, build_id, note_id, user_id):
    """Process a follow-up/progress meeting note as a DELTA: capture scope changes
    as ChangeRequests, new questions as QUESTION tasklist items, log progress, and
    refresh the build's living memory summary (review-first)."""
    build = Build.objects.filter(pk=build_id).first()
    note = MeetingNote.objects.filter(pk=note_id).first()
    if not build or not note:
        return
    user = User.objects.filter(pk=user_id).first()
    try:
        delta = services.extract_progress_delta(build, note.raw_text)
    except Exception:  # noqa: BLE001
        note.ai_status = "failed"
        note.save(update_fields=["ai_status"])
        return

    actor = _user_name(user) or "system"
    scope_changes = delta.get("scopeChanges", []) or []
    questions = delta.get("newQuestions", []) or []
    progress = delta.get("progress", []) or []

    with transaction.atomic():
        for sc in scope_changes:
            ChangeRequest.objects.create(
                build=build, created_by=(user or build.creator),
                title=(sc.get("title") or "Change request")[:500],
                description=sc.get("description", "") or "",
                impact=sc.get("impact", "") or "",
                requester=(sc.get("requester") or "Client")[:255],
            )
        # Open questions raised this meeting become QUESTION items on the tasklist
        # (gaps were folded into the single source-faithful list).
        q_start = (build.action_items.aggregate(m=models.Max("order")).get("m") or 0) + 1
        for idx, q in enumerate(questions):
            qtext = (q.get("question") or "").strip()
            if not qtext:
                continue
            MeetingActionItem.objects.create(
                build=build, text=qtext[:4000], detail=(q.get("rationale") or "").strip(),
                category="QUESTION", section=_clean_section(q.get("section")),
                introduced_in=note, last_changed_in=note, ai_generated=True, order=q_start + idx,
            )
        summary = (delta.get("summary") or "").strip()
        if summary:
            build.memory_summary = summary[:8000]
            build.save(update_fields=["memory_summary", "updated_at"])

        BuildMemorySnapshot.objects.create(
            build=build, created_by=user, created_by_ai=True,
            summary=f"Progress update: {note.title or 'meeting'}.",
            open_questions="\n".join(q.get("question", "") for q in questions),
            scope_changes=(("Progress:\n" + "\n".join(f"- {p}" for p in progress) + "\n\n") if progress else "")
                          + f"{len(scope_changes)} change request(s), {len(questions)} new question(s) captured.",
        )
        Activity.objects.create(
            build=build, actor=actor,
            message=f"{note.title or 'Progress update'}: "
                    f"{len(scope_changes)} change request(s), {len(questions)} question(s) captured.",
        )

    note.ai_output = delta
    note.ai_status = "done"
    note.ai_model = services._blueprint_model()
    note.save(update_fields=["ai_output", "ai_status", "ai_model"])


_VALID_SECTIONS = {c[0] for c in MeetingActionItem._meta.get_field("section").choices}
_VALID_CATEGORIES = {c[0] for c in MeetingActionItem._meta.get_field("category").choices}


def _clean_section(value: str) -> str:
    """Map an AI section value to a stored value ("OTHER"/unknown → "" uncategorized)."""
    v = (value or "").strip().upper()
    return v if v in _VALID_SECTIONS else ""


def _clean_category(value: str) -> str:
    v = (value or "").strip().upper()
    return v if v in _VALID_CATEGORIES else "REQUEST"


@shared_task(bind=True, max_retries=1, default_retry_delay=15)
def generate_meeting_tasklist(self, build_id, note_id, user_id):
    """Build / re-sync the source-faithful tasklist from meeting notes.

    First run extracts EVERY requested task/change/question from all notes; later runs
    reconcile the given note against the current list (add / modify / supersede) so the
    list stays a single living plan. Non-destructive: human-edited (locked) and
    human-added (ai_generated=False) items are never wiped. Progress is tracked on
    build.tasklist_status, which the frontend polls.
    """
    build = Build.objects.filter(pk=build_id).first()
    if not build:
        return
    user = User.objects.filter(pk=user_id).first()
    note = MeetingNote.objects.filter(pk=note_id).first()
    actor = _user_name(user) or "system"
    # Ground categorization/phrasing in how Calari builds (Build Library), never scope.
    reference = services.build_reference_context(build)

    existing = list(build.action_items.filter(superseded=False))
    has_any = build.action_items.exists()

    try:
        if has_any:
            delta = services.reconcile_meeting_tasklist(existing, note.raw_text if note else "", reference_text=reference)
            added, modified, dropped = _apply_tasklist_delta(build, delta, note)
            msg = f"Tasklist re-synced: +{added} new, ~{modified} changed, ✗{dropped} superseded."
        else:
            notes_text = "\n\n".join(build.meeting_notes.order_by("created_at").values_list("raw_text", flat=True))
            data = services.extract_meeting_tasklist(notes_text, reference_text=reference)
            added = _apply_tasklist_full(build, data.get("items", []), note)
            msg = f"Tasklist generated: {added} item(s) captured from meeting notes."
    except Exception:  # noqa: BLE001 — surface failure so the UI doesn't hang on "processing"
        build.tasklist_status = "failed"
        build.save(update_fields=["tasklist_status", "updated_at"])
        return

    build.tasklist_status = "done"
    build.save(update_fields=["tasklist_status", "updated_at"])
    Activity.objects.create(build=build, actor=actor, message=msg)


def _apply_tasklist_full(build, items, note):
    """First run: replace only AI-authored, unlocked items; keep human work."""
    with transaction.atomic():
        build.action_items.filter(ai_generated=True, locked=False).delete()
        start = (build.action_items.aggregate(m=models.Max("order")).get("m") or 0) + 1
        objs = []
        for i, it in enumerate(items):
            objs.append(MeetingActionItem(
                build=build,
                text=(it.get("text") or "").strip()[:4000],
                detail=(it.get("detail") or "").strip(),
                category=_clean_category(it.get("category")),
                section=_clean_section(it.get("section")),
                introduced_in=note,
                ai_generated=True,
                order=start + i,
            ))
        objs = [o for o in objs if o.text]
        MeetingActionItem.objects.bulk_create(objs)
    return len(objs)


def _apply_tasklist_delta(build, delta, note):
    """Follow-up run: apply add / modify / supersede ops by id, non-destructively."""
    add = delta.get("add", []) or []
    modify = delta.get("modify", []) or []
    supersede = delta.get("supersede", []) or []
    with transaction.atomic():
        start = (build.action_items.aggregate(m=models.Max("order")).get("m") or 0) + 1
        new_objs = []
        for i, it in enumerate(add):
            text = (it.get("text") or "").strip()[:4000]
            if not text:
                continue
            new_objs.append(MeetingActionItem(
                build=build, text=text, detail=(it.get("detail") or "").strip(),
                category=_clean_category(it.get("category")), section=_clean_section(it.get("section")),
                introduced_in=note, last_changed_in=note, ai_generated=True, order=start + i,
            ))
        MeetingActionItem.objects.bulk_create(new_objs)

        modified = 0
        for it in modify:
            obj = build.action_items.filter(pk=it.get("id"), locked=False).first()
            if not obj:
                continue  # missing or human-locked — never overwrite human edits
            obj.text = (it.get("text") or obj.text).strip()[:4000]
            obj.detail = (it.get("detail") or "").strip()
            obj.category = _clean_category(it.get("category"))
            obj.section = _clean_section(it.get("section"))
            obj.last_changed_in = note
            obj.save(update_fields=["text", "detail", "category", "section", "last_changed_in", "updated_at"])
            modified += 1

        dropped = 0
        for it in supersede:
            obj = build.action_items.filter(pk=it.get("id"), superseded=False).first()
            if not obj:
                continue
            obj.superseded = True
            obj.superseded_reason = (it.get("reason") or "").strip()
            obj.last_changed_in = note
            obj.save(update_fields=["superseded", "superseded_reason", "last_changed_in", "updated_at"])
            dropped += 1
    return len(new_objs), modified, dropped


_VALID_ITEM_STATUS = {c[0] for c in MeetingActionItem._meta.get_field("status").choices}


@shared_task(bind=True, max_retries=1, default_retry_delay=15)
def analyze_build_progress(self, build_id, report_id, user_id):
    """Audit a staff progress report against the tasklist: check off genuinely-done
    items, set a Verified / Needs-info verdict per item, capture reported-but-new work,
    and record the AI's expert pushback. Auto-applies; human-locked items are skipped.
    Tracked on the report's ai_status (the frontend polls it)."""
    build = Build.objects.filter(pk=build_id).first()
    report = ProgressReport.objects.filter(pk=report_id).first()
    if not build or not report:
        return
    user = User.objects.filter(pk=user_id).first()
    actor = _user_name(user) or "system"
    try:
        reference = services.build_reference_context(build)
    except Exception:  # noqa: BLE001
        reference = ""
    # Optional: inspect the client's REAL GHL account (GHL MCP) so the audit verifies
    # against ground truth, not just the staff write-up. No-op unless GHL MCP is configured.
    try:
        focus = "\n".join(
            it.text for it in build.action_items.filter(superseded=False).only("text")[:60]
        )
        ghl_state = services.ghl_state_snapshot(build, focus=focus)
    except Exception:  # noqa: BLE001 — live verification is a bonus, never block the audit
        ghl_state = ""
    try:
        audit = services.analyze_progress_report(
            build, report.raw_text, reference_text=reference, ghl_state=ghl_state)
    except Exception:  # noqa: BLE001 — surface failure so the UI doesn't hang
        report.ai_status = "failed"
        report.save(update_fields=["ai_status"])
        return

    verified = needs_info = 0
    with transaction.atomic():
        for it in audit.get("items", []) or []:
            obj = build.action_items.filter(pk=it.get("id"), superseded=False, locked=False).first()
            if not obj:
                continue  # missing or human-locked (override wins)
            status = (it.get("status") or "").upper()
            if status in _VALID_ITEM_STATUS:
                obj.status = status
            verdict = (it.get("verification") or "").upper()
            obj.verification = "VERIFIED" if verdict == "VERIFIED" else "NEEDS_INFO"
            obj.evidence = (it.get("evidence") or "").strip()
            obj.verification_note = (it.get("note") or "").strip()
            obj.save(update_fields=["status", "verification", "evidence", "verification_note", "updated_at"])
            if obj.verification == "VERIFIED":
                verified += 1
            else:
                needs_info += 1

        # Completed work the staff reported that wasn't on the list yet.
        start = (build.action_items.aggregate(m=models.Max("order")).get("m") or 0) + 1
        for idx, nw in enumerate(audit.get("newWork", []) or []):
            text = (nw.get("text") or "").strip()
            if not text:
                continue
            MeetingActionItem.objects.create(
                build=build, text=text[:4000], detail=(nw.get("detail") or "").strip(),
                category=_clean_category(nw.get("category")), section=_clean_section(nw.get("section")),
                status="DONE", verification="VERIFIED", evidence="Reported as completed by staff.",
                ai_generated=True, order=start + idx,
            )

        pushback = [p for p in (audit.get("pushback") or []) if (p or "").strip()]
        report.ai_output = audit
        report.summary = (audit.get("summary") or "").strip()
        report.pushback = pushback
        report.verified_count = verified
        report.needs_info_count = needs_info
        report.ai_status = "done"
        report.ai_model = services._blueprint_model()
        report.save(update_fields=[
            "ai_output", "summary", "pushback", "verified_count", "needs_info_count",
            "ai_status", "ai_model",
        ])
        Activity.objects.create(
            build=build, actor=actor,
            message=f"Progress report audited: {verified} verified, {needs_info} need info"
                    + (f", {len(pushback)} open question(s)" if pushback else "")
                    + (" (verified against live GHL)." if ghl_state else "."),
        )
