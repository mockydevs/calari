"""Backfill ai_generated=True on pre-existing blueprint items.

Before this field existed, regeneration wiped ALL blueprint rows. Now it only
wipes ai_generated=True rows, so historical rows (default False) would survive and
duplicate on the next regenerate. Mark them ai_generated=True to preserve the old
replace-on-regenerate behavior for existing builds. (Task keeps its real values.)
"""
from django.db import migrations

MODELS = [
    "PipelineStage", "ContactSource", "Calendar", "Integration", "StageTransition",
    "Workflow", "CustomField", "TagDefinition", "PreLaunchItem",
]


def forwards(apps, schema_editor):
    for name in MODELS:
        apps.get_model("builds", name).objects.update(ai_generated=True)


def backwards(apps, schema_editor):
    pass  # one-way data fix; nothing to undo


class Migration(migrations.Migration):
    dependencies = [("builds", "0005_buildknowledge")]
    operations = [migrations.RunPython(forwards, backwards)]
