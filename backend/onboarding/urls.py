from rest_framework.routers import DefaultRouter

from . import views

app_name = "onboarding"

router = DefaultRouter()
router.register(r"connections", views.ConnectionViewSet, basename="connections")
router.register(r"integration-maps", views.IntegrationMapViewSet, basename="integration-maps")
router.register(r"call-insights", views.CallInsightViewSet, basename="call-insights")
router.register(r"integration-events", views.IntegrationEventViewSet, basename="integration-events")

urlpatterns = router.urls
