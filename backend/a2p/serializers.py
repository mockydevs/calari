from rest_framework import serializers

from .models import A2PSubmission


class A2PSubmissionSerializer(serializers.ModelSerializer):
    """Full record — used by the staff portal (read + status/review updates)."""

    class Meta:
        model = A2PSubmission
        fields = "__all__"
        # The public form sets the data fields; status/review are staff-only and
        # never accepted from the public create payload (the viewset enforces this).
        read_only_fields = ["created_at", "updated_at"]


class A2PSubmissionCreateSerializer(serializers.ModelSerializer):
    """Public intake payload — only the questionnaire fields, never staff workflow."""

    class Meta:
        model = A2PSubmission
        exclude = ["status", "review_notes", "created_at", "updated_at"]
