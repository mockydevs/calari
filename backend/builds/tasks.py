"""Background tasks for the Builds domain (OpenAI brief generation, etc.)."""
from celery import shared_task
from django.contrib.auth import get_user_model
from django.db import transaction

from . import services
from .models import (
    Build, BuildStatus, ContactSource, PipelineStage, ManualAction, Task,
    BuildMemorySnapshot, Activity, StageTransition, Workflow, CustomField,
    TagDefinition, PreLaunchItem, VisionGap, GapStatus, Calendar, Integration,
    ChangeRequest, MeetingNote,
)

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
        actor=(user.get_full_name() or user.username) if user else "system",
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
    as ChangeRequests, new questions as gaps, log progress, and refresh the build's
    living memory summary — WITHOUT rewriting the blueprint (review-first)."""
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

    actor = (user.get_full_name() or user.username) if user else "system"
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
        for q in questions:
            VisionGap.objects.create(
                build=build, category=q.get("category", "GENERAL"), question=q.get("question", ""),
                rationale=q.get("rationale", ""), severity=q.get("severity", "medium"), created_by_ai=True,
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


@shared_task(bind=True, max_retries=1, default_retry_delay=15)
def generate_build_brief(self, build_id, user_id):
    """Generate the full AI vision blueprint (handover anatomy + gaps) for a build.

    The OpenAI call can take 10–30s, so the view dispatches this and returns
    immediately; progress is tracked on the latest meeting note's ai_status
    (processing → done | failed), which the frontend polls.
    """
    build = Build.objects.filter(pk=build_id).first()
    if not build:
        return
    user = User.objects.filter(pk=user_id).first()
    latest_note = build.meeting_notes.order_by("-created_at").first()
    notes = "\n\n".join(build.meeting_notes.order_by("created_at").values_list("raw_text", flat=True))

    # Learning loop: ground generation in the Build Library (how Calari builds).
    reference = services.build_reference_context(build)
    # Authoritative context: the living build-state memory (kept fresh by progress
    # updates) + previously-answered gaps, so regeneration incorporates everything
    # learned since kickoff instead of re-deriving or re-asking.
    resolved_parts = []
    if (build.memory_summary or "").strip():
        resolved_parts.append("CURRENT BUILD STATE (kept current by progress updates):\n" + build.memory_summary)
    answered = build.gaps.filter(status=GapStatus.ANSWERED).exclude(answer="")
    answered_text = "\n".join(f"Q: {g.question}\nA: {g.answer}" for g in answered)
    if answered_text:
        resolved_parts.append("ANSWERED QUESTIONS:\n" + answered_text)
    resolved = "\n\n".join(resolved_parts)

    try:
        draft = services.generate_blueprint_draft(notes, reference_text=reference, resolved_text=resolved)
        # Persist inside the same guard: a persistence hiccup must mark the note
        # "failed" (so the UI shows a clear error) instead of leaving it stuck on
        # "processing" forever.
        _persist_blueprint(build, draft, user)
    except Exception:  # noqa: BLE001 — record failure so the UI can surface it
        if latest_note:
            latest_note.ai_status = "failed"
            latest_note.save(update_fields=["ai_status"])
        return

    if latest_note:
        latest_note.ai_output = draft
        latest_note.ai_status = "done"
        latest_note.ai_model = services._blueprint_model()
        latest_note.save(update_fields=["ai_output", "ai_status", "ai_model"])

    # Auto self-critique: run QA right after generation so the admin sees a draft
    # that's already been reviewed. Non-fatal — never undo a good generation.
    try:
        _run_qa_snapshot(build, user)
    except Exception:  # noqa: BLE001
        pass


# Public alias — the new name; `generate_build_brief` kept so existing dispatch works.
generate_build_blueprint = generate_build_brief


def _prov(item: dict) -> dict:
    """Provenance flags an AI item carries into the DB (ai_generated + inferred/confidence)."""
    conf = (item.get("confidence") or "").strip().lower()
    return {
        "ai_generated": True,
        "inferred": bool(item.get("inferred")),
        "confidence": conf if conf in ("high", "medium", "low") else "",
    }


def _persist_blueprint(build, draft, user):
    """Merge a fresh AI extraction into the build NON-DESTRUCTIVELY: only AI-authored,
    unlocked rows are replaced. Rows a human added (ai_generated=False) or edited
    (locked=True) are preserved, so regeneration never wipes human work."""
    with transaction.atomic():
        before = {
            "stages": build.stages.count(), "workflows": build.workflows.count(),
            "tasks": build.tasks.count(), "gaps": build.gaps.filter(status=GapStatus.OPEN).count(),
        }
        # Wipe ONLY AI-authored, unlocked rows (idempotent re-generation that
        # preserves human additions/edits). Children (sources/calendars/transitions)
        # first, then stages.
        for rel in ("contact_sources", "calendars", "external_integrations",
                    "transitions", "workflows", "custom_fields", "tags", "pre_launch_items"):
            getattr(build, rel).filter(ai_generated=True, locked=False).delete()
        build.stages.filter(ai_generated=True, locked=False).delete()  # cascades manual actions
        build.tasks.filter(ai_generated=True, locked=False).delete()
        # Refresh only AI-authored open gaps; keep ones a human has answered/dismissed.
        build.gaps.filter(created_by_ai=True, status=GapStatus.OPEN).delete()

        build.overview = draft.get("overview", "") or ""
        build.one_line_summary = draft.get("oneLineSummary", "") or ""
        build.maintenance_notes = draft.get("maintenanceNotes", "") or ""
        build.goals = draft.get("goals", "") or ""
        # Defensive: integrations is a string list, but coerce in case the model
        # returns numbers/objects so a stray type never crashes the whole persist.
        build.integrations = ", ".join(str(x).strip() for x in (draft.get("integrations") or []) if x)
        build.status = BuildStatus.AI_DRAFTED
        build.save(update_fields=[
            "overview", "one_line_summary", "maintenance_notes",
            "goals", "integrations", "status", "updated_at",
        ])

        # Stages first — sources and transitions resolve to them by name.
        for st in draft.get("pipelineStages", []):
            stage = PipelineStage.objects.create(
                build=build, name=st.get("name", ""), description=st.get("description", ""),
                entry_condition=st.get("entryCondition", ""), order=st.get("order", 0),
                is_automatic=bool(st.get("isAutomatic", True)),
                needs_manual=bool(st.get("manualActions")), **_prov(st),
            )
            for ma in st.get("manualActions", []):
                ManualAction.objects.create(stage=stage, description=ma.get("description", ""), owner=ma.get("owner", ""))

        # Resolve stage names against ALL current stages (new + surviving human/locked ones).
        stage_by_name = {s.name.strip().lower(): s for s in build.stages.all()}
        unresolved: set[str] = set()

        def resolve(name: str):
            key = (name or "").strip().lower()
            stage = stage_by_name.get(key)
            if key and stage is None:
                unresolved.add(name.strip())
            return stage

        for i, cs in enumerate(draft.get("leadSources", [])):
            ContactSource.objects.create(
                build=build, type=cs.get("type", "OTHER"), label=cs.get("label", ""),
                entry_mechanism=cs.get("entryMechanism", ""), fires=cs.get("fires", ""),
                tags_applied=cs.get("tagsApplied", ""), handling_workflow=cs.get("handlingWorkflow", ""),
                entry_stage=resolve(cs.get("entryStage", "")), notes=cs.get("notes", ""), order=i, **_prov(cs),
            )

        for i, cal in enumerate(draft.get("calendars", [])):
            Calendar.objects.create(
                build=build, name=cal.get("name", ""), type=cal.get("type", "OTHER"),
                purpose=cal.get("purpose", ""), assigned_to=cal.get("assignedTo", ""),
                books_into_stage=resolve(cal.get("booksIntoStage", "")),
                on_booking=cal.get("onBooking", ""), reminders=cal.get("reminders", ""),
                notes=cal.get("notes", ""), order=i, **_prov(cal),
            )

        for i, ig in enumerate(draft.get("externalIntegrations", [])):
            Integration.objects.create(
                build=build, name=ig.get("name", ""), direction=ig.get("direction", "INBOUND"),
                mechanism=ig.get("mechanism", "API"), data_objects=ig.get("dataObjects", ""),
                purpose=ig.get("purpose", ""), trigger_cadence=ig.get("triggerCadence", ""),
                notes=ig.get("notes", ""), order=i, **_prov(ig),
            )

        for i, tr in enumerate(draft.get("stageTransitions", [])):
            StageTransition.objects.create(
                build=build, from_stage=resolve(tr.get("fromStage", "")), to_stage=resolve(tr.get("toStage", "")),
                from_label=tr.get("fromStage", ""), to_label=tr.get("toStage", ""),
                trigger=tr.get("trigger", ""), is_automatic=bool(tr.get("isAutomatic", True)),
                notes=tr.get("notes", ""), order=i, ai_generated=True,
            )

        for i, wf in enumerate(draft.get("workflows", [])):
            Workflow.objects.create(
                build=build, code=wf.get("code", ""), category=wf.get("category", "OTHER"),
                name=wf.get("name", ""), trigger=wf.get("trigger", ""),
                what_it_does=wf.get("whatItDoes", ""), patient_facing=bool(wf.get("patientFacing", False)),
                order=i, **_prov(wf),
            )

        for i, cf in enumerate(draft.get("customFields", [])):
            CustomField.objects.create(
                build=build, kind=cf.get("kind", "FIELD"), key=cf.get("key", ""),
                description=cf.get("description", ""), populated=bool(cf.get("populated", True)),
                order=i, ai_generated=True,
            )

        for i, tg in enumerate(draft.get("tags", [])):
            TagDefinition.objects.create(
                build=build, tag=tg.get("tag", ""), meaning=tg.get("meaning", ""), order=i, ai_generated=True,
            )

        for i, pl in enumerate(draft.get("preLaunchItems", [])):
            PreLaunchItem.objects.create(
                build=build, description=pl.get("description", ""), optional=bool(pl.get("optional", False)),
                order=i, ai_generated=True,
            )

        for tk in draft.get("tasks", []):
            Task.objects.create(
                build=build, title=tk.get("title", ""), type=tk.get("type", "OTHER"),
                description=tk.get("description", ""), ai_generated=True,
            )

        for gp in draft.get("gaps", []):
            VisionGap.objects.create(
                build=build, category=gp.get("category", "GENERAL"), question=gp.get("question", ""),
                rationale=gp.get("rationale", ""), severity=gp.get("severity", "medium"), created_by_ai=True,
            )

        # Referential validation: a transition/source/calendar that named a stage we
        # couldn't match is a real inconsistency — surface each as a gap, not silently drop.
        for name in sorted(unresolved):
            VisionGap.objects.create(
                build=build, category="STAGE", created_by_ai=True, severity="medium",
                question=f'The stage "{name}" is referenced but not defined in the pipeline — should it be added?',
                rationale="A lead source, calendar, or transition points at a stage that isn't in the pipeline list.",
            )

        open_gaps = build.gaps.filter(status=GapStatus.OPEN).count()
        after = {
            "stages": build.stages.count(), "workflows": build.workflows.count(),
            "tasks": build.tasks.count(), "gaps": open_gaps,
        }
        diff = ", ".join(f"{k}: {before[k]}→{after[k]}" for k in after if before.get(k) != after[k]) or "no net change"
        BuildMemorySnapshot.objects.create(
            build=build, created_by=user, created_by_ai=True,
            summary="AI vision blueprint generated.",
            scope_changes=f"Changes — {diff}. "
                          + (f"{open_gaps} open gap(s) flagged." if open_gaps else "No gaps flagged."),
        )
        Activity.objects.create(
            build=build,
            actor=(user.get_full_name() or user.username) if user else "system",
            message=f"AI vision blueprint generated ({open_gaps} open gap(s)).",
        )
