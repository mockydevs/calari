from django.contrib import admin

from .models import Connection, IntegrationMap, CallInsight, IntegrationEvent


@admin.register(Connection)
class ConnectionAdmin(admin.ModelAdmin):
    list_display = ("provider", "label", "auth_type", "active", "updated_at")
    list_filter = ("provider", "active", "auth_type")
    readonly_fields = ("encrypted_secret", "encrypted_refresh", "secret_preview")


@admin.register(IntegrationMap)
class IntegrationMapAdmin(admin.ModelAdmin):
    list_display = ("client", "client_number", "active", "updated_at")
    list_filter = ("active",)
    search_fields = ("client__name", "client_number")


@admin.register(CallInsight)
class CallInsightAdmin(admin.ModelAdmin):
    list_display = ("title", "client", "status", "confidence", "created_at")
    list_filter = ("status",)
    search_fields = ("title", "fireflies_call_id")


@admin.register(IntegrationEvent)
class IntegrationEventAdmin(admin.ModelAdmin):
    list_display = ("call_insight", "target", "status", "attempts", "updated_at")
    list_filter = ("target", "status")
