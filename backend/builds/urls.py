from rest_framework.routers import DefaultRouter
from django.urls import path
from . import views

app_name = "builds"

router = DefaultRouter()
router.register(r"builds", views.BuildViewSet, basename="builds")
router.register(r"tasks", views.TaskViewSet, basename="tasks")
router.register(r"meeting-notes", views.MeetingNoteViewSet, basename="meeting-notes")
router.register(r"action-items", views.MeetingActionItemViewSet, basename="action-items")
router.register(r"progress-reports", views.ProgressReportViewSet, basename="progress-reports")
router.register(r"knowledge", views.BuildKnowledgeViewSet, basename="knowledge")
router.register(r"documents", views.DocumentViewSet, basename="documents")
router.register(r"comments", views.CommentViewSet, basename="comments")
router.register(r"activity", views.ActivityViewSet, basename="activity")
router.register(r"change-requests", views.ChangeRequestViewSet, basename="change-requests")
router.register(r"approvals", views.ApprovalRecordViewSet, basename="approvals")
router.register(r"section-reviews", views.BuildSectionReviewViewSet, basename="section-reviews")
router.register(r"memory-snapshots", views.BuildMemorySnapshotViewSet, basename="memory-snapshots")
router.register(r"task-dependencies", views.TaskDependencyViewSet, basename="task-dependencies")
router.register(r"notifications", views.NotificationViewSet, basename="notifications")
router.register(r"ai-keys", views.AiApiKeyViewSet, basename="ai-keys")
router.register(r"team-invites", views.TeamInviteViewSet, basename="team-invites")

urlpatterns = [
    path("my-builds/", views.my_builds, name="my-builds"),
    path("notification-preferences/", views.notification_preferences, name="notification-preferences"),
    path("ai-config/", views.ai_config, name="ai-config"),
    path("ai-usage/", views.ai_usage, name="ai-usage"),
    path("upload/presign/", views.upload_presign, name="upload-presign"),
    path("upload/finalize/", views.upload_finalize, name="upload-finalize"),
    path("portal/<str:token>/build/", views.portal_build, name="portal-build"),
    path("portal/<str:token>/feedback/", views.portal_feedback, name="portal-feedback"),
    path("invite/<str:token>/", views.invite_detail, name="invite-detail"),
    path("invite/<str:token>/accept/", views.invite_accept, name="invite-accept"),
] + router.urls
