from rest_framework import serializers

from .models import Connection, IntegrationMap, CallInsight, IntegrationEvent, AutomationSettings
from .services import encrypt_secret


class AutomationSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = AutomationSettings
        fields = ["enabled", "external_posting_enabled", "confidence_threshold",
                  "ops_alert_channel_id", "updated_at"]
        read_only_fields = ["updated_at"]


class ConnectionSerializer(serializers.ModelSerializer):
    # Secrets are write-only; only the preview is ever returned.
    secret = serializers.CharField(write_only=True, required=False, allow_blank=True)
    refresh_token = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = Connection
        fields = [
            "id", "provider", "auth_type", "label", "secret_preview", "scopes",
            "expires_at", "workspace_ref", "active", "created_at", "updated_at",
            "secret", "refresh_token",
        ]
        read_only_fields = ["secret_preview", "created_at", "updated_at"]

    def _apply_secrets(self, validated):
        secret = validated.pop("secret", None)
        refresh = validated.pop("refresh_token", None)
        if secret:
            encrypted, preview = encrypt_secret(secret)
            validated["encrypted_secret"] = encrypted
            validated["secret_preview"] = preview
        if refresh:
            validated["encrypted_refresh"] = encrypt_secret(refresh)[0]
        return validated

    def create(self, validated):
        validated = self._apply_secrets(validated)
        if not validated.get("encrypted_secret"):
            raise serializers.ValidationError({"secret": "A secret / token is required."})
        # One active connection per provider.
        if validated.get("active", True):
            Connection.objects.filter(provider=validated["provider"], active=True).update(active=False)
        return super().create(validated)

    def update(self, instance, validated):
        validated = self._apply_secrets(validated)
        if validated.get("active"):
            Connection.objects.filter(provider=instance.provider, active=True).exclude(pk=instance.pk).update(active=False)
        return super().update(instance, validated)


class IntegrationMapSerializer(serializers.ModelSerializer):
    client_name = serializers.SerializerMethodField()

    class Meta:
        model = IntegrationMap
        fields = "__all__"

    def get_client_name(self, obj):
        return obj.client.name if obj.client_id else None


class IntegrationEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = IntegrationEvent
        fields = "__all__"


class CallInsightSerializer(serializers.ModelSerializer):
    client_name = serializers.SerializerMethodField()
    events = IntegrationEventSerializer(many=True, read_only=True)

    class Meta:
        model = CallInsight
        exclude = ["raw_transcript"]  # can be very large

    def get_client_name(self, obj):
        return obj.client.name if obj.client_id else None
