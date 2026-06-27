from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

app_name = "onboarding"

router = DefaultRouter()
router.register(r"connections", views.ConnectionViewSet, basename="connections")
router.register(r"integration-maps", views.IntegrationMapViewSet, basename="integration-maps")
router.register(r"call-insights", views.CallInsightViewSet, basename="call-insights")
router.register(r"integration-events", views.IntegrationEventViewSet, basename="integration-events")

urlpatterns = [
    path("automation-settings/", views.automation_settings, name="automation-settings"),
    path("clients/<int:client_id>/upsell/", views.client_upsell, name="client-upsell"),
    path("webhooks/fireflies/", views.fireflies_webhook, name="fireflies-webhook"),
    path("oauth/<str:provider>/authorize-url/", views.oauth_authorize_url, name="oauth-authorize-url"),
    path("oauth/<str:provider>/callback/", views.oauth_callback, name="oauth-callback"),
] + router.urls
