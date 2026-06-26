from rest_framework.routers import DefaultRouter

from . import views

app_name = "a2p"

router = DefaultRouter()
router.register(r"submissions", views.A2PSubmissionViewSet, basename="a2p-submissions")

urlpatterns = router.urls
