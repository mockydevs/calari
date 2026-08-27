from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views, fathom, slack_intake, slack_context, investigation_views

app_name = "onboarding"

router = DefaultRouter()
router.register(r"connections", views.ConnectionViewSet, basename="connections")
router.register(r"integration-maps", views.IntegrationMapViewSet, basename="integration-maps")
router.register(r"call-insights", views.CallInsightViewSet, basename="call-insights")
router.register(r"integration-events", views.IntegrationEventViewSet, basename="integration-events")
router.register(r"fathom/rules", fathom.RuleViewSet, basename="fathom-rules")
router.register(r"fathom/meetings", fathom.MeetingViewSet, basename="fathom-meetings")
router.register(r"slack/channels", slack_intake.ChannelViewSet, basename="slack-channels")
router.register(r"slack/responsibilities", slack_intake.ResponsibilityViewSet, basename="slack-responsibilities")
router.register(r"slack/events", slack_intake.EventViewSet, basename="slack-events")

urlpatterns = [
    path("slack/context/", slack_context.connection_view, name="slack-context-connection"),
    path("slack/context/authorize/", slack_context.authorize, name="slack-context-authorize"),
    path("slack/context/callback/", slack_context.callback, name="slack-context-callback"),
    path("clients/<int:client_id>/context-policy/", investigation_views.policy_view, name="context-policy"),
    path("slack/settings/", slack_intake.settings_view, name="slack-settings"),
    path("webhooks/slack/", slack_intake.webhook, name="slack-webhook"),
    path("fathom/settings/", fathom.settings_view, name="fathom-settings"),
    path("webhooks/fathom/", fathom.webhook, name="fathom-webhook"),
    path("automation-settings/", views.automation_settings, name="automation-settings"),
    path("dry-run/", views.dry_run, name="dry-run"),
    path("clients/<int:client_id>/upsell/", views.client_upsell, name="client-upsell"),
    path("webhooks/fireflies/", views.fireflies_webhook, name="fireflies-webhook"),
    path("oauth/<str:provider>/authorize-url/", views.oauth_authorize_url, name="oauth-authorize-url"),
    path("oauth/<str:provider>/callback/", views.oauth_callback, name="oauth-callback"),
] + router.urls
