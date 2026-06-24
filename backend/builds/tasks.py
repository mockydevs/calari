"""Background tasks for the Builds domain (OpenAI brief generation, etc.)."""
from celery import shared_task
from django.contrib.auth import get_user_model
from django.db import transaction

from . import services
from .models import (
    Build, BuildStatus, ContactSource, PipelineStage, ManualAction, Task,
    BuildMemorySnapshot, Activity,
)

User = get_user_model()


@shared_task(bind=True, max_retries=1, default_retry_delay=15)
def generate_build_brief(self, build_id, user_id):
    """Generate the AI brief for a build off the request path.

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

    try:
        draft = services.generate_brief_draft(notes)
    except Exception:  # noqa: BLE001 — record failure so the UI can surface it
        if latest_note:
            latest_note.ai_status = "failed"
            latest_note.save(update_fields=["ai_status"])
        return

    with transaction.atomic():
        # Replace prior AI-generated structure.
        build.contact_sources.all().delete()
        build.stages.all().delete()
        build.tasks.filter(ai_generated=True).delete()

        build.goals = draft.get("goals", "")
        build.integrations = ", ".join(draft.get("integrations", []))
        build.status = BuildStatus.AI_DRAFTED
        build.save(update_fields=["goals", "integrations", "status", "updated_at"])

        for cs in draft.get("contactSources", []):
            ContactSource.objects.create(build=build, type=cs.get("type", "OTHER"), label=cs.get("label", ""))
        for st in draft.get("pipelineStages", []):
            stage = PipelineStage.objects.create(
                build=build, name=st.get("name", ""), description=st.get("description", ""),
                order=st.get("order", 0), needs_manual=bool(st.get("manualActions")),
            )
            for ma in st.get("manualActions", []):
                ManualAction.objects.create(stage=stage, description=ma.get("description", ""), owner=ma.get("owner", ""))
        for tk in draft.get("tasks", []):
            Task.objects.create(
                build=build, title=tk.get("title", ""), type=tk.get("type", "OTHER"),
                description=tk.get("description", ""), ai_generated=True,
            )

        if latest_note:
            latest_note.ai_output = draft
            latest_note.ai_status = "done"
            latest_note.save(update_fields=["ai_output", "ai_status"])
        BuildMemorySnapshot.objects.create(
            build=build, created_by=user, created_by_ai=True,
            summary="AI brief generated.", scope_changes="",
        )
        Activity.objects.create(
            build=build,
            actor=(user.get_full_name() or user.username) if user else "system",
            message="AI brief generated.",
        )
