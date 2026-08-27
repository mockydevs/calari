"""Deterministic acceptance criteria. No model may assert a passed check."""
from rest_framework import serializers
from rest_framework.response import Response
from django.db import transaction
from .models import Task


class CheckSerializer(serializers.Serializer):
    area = serializers.ChoiceField(choices=["pipelines", "tags", "forms", "workflows", "customFields"])
    record_id = serializers.RegexField(r"^[A-Za-z0-9_-]{1,120}$")
    field = serializers.ChoiceField(choices=["exists", "name", "status"])
    expected = serializers.CharField(max_length=160, allow_blank=True, default="")


class ChecksSerializer(serializers.Serializer):
    checks = CheckSerializer(many=True, max_length=8)


def view(request, task):
    from onboarding.investigation_views import private_access
    private_access(request.user, task)
    if request.method == "PUT":
        serializer = ChecksSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            current = Task.objects.select_for_update().get(pk=task.pk)
            changes = {"ghl_acceptance_checks": serializer.validated_data["checks"]}
            if current.status == "DONE":
                from .serializers import TaskCardSerializer
                TaskCardSerializer._queue_verification(changes, True)
            Task.objects.filter(pk=task.pk).update(**changes)
            task.refresh_from_db()
    return Response({"checks": task.ghl_acceptance_checks})


def evaluate(checks, evidence):
    results = []
    for check in checks[:8]:
        area = next((e for e in evidence if e["key"] == "ghl:" + check["area"]), None)
        rows = area["observation"].get("records", []) if area else []
        row = next((r for r in rows if r.get("id") == check["record_id"]), None)
        state = "needs_evidence"
        detail = "Resource not present in the bounded read; absence is not proven."
        if area and area["completeness"] == "unavailable":
            state, detail = "unavailable", "This read was unavailable."
        elif row:
            if check["field"] == "exists":
                state, detail = "passed_check", "Exact resource ID was observed."
            elif check["field"] in row:
                state = "passed_check" if str(row[check["field"]]) == check["expected"] else "failed_check"
                detail = f"Observed {check['field']}: {row[check['field']]}"
            else:
                detail = "The API did not expose the requested field."
        results.append({**check, "status": state, "detail": detail})
    return results
