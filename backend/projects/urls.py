from rest_framework.routers import DefaultRouter
from django.urls import path
from . import views

app_name = 'projects'

router = DefaultRouter()
router.register(r'clients',              views.ClientsViewSet,              basename='clients')
router.register(r'projects',             views.ProjectsViewSet,             basename='projects')
router.register(r'project-files',        views.ProjectFilesViewSet,         basename='project-files')
router.register(r'project-contacts',     views.ProjectContactPersonViewSet, basename='project-contacts')
router.register(r'project-blockers',     views.ProjectBlockersViewSet,      basename='project-blockers')
router.register(r'project-co-assign',    views.ProjectCoAssignmentViewSet,  basename='project-co-assign')
router.register(r'project-milestones',   views.ProjectMilestoneViewSet,     basename='project-milestones')
router.register(r'project-activity',     views.ProjectActivityViewSet,      basename='project-activity')
router.register(r'tasks',                views.TasksViewSet,                basename='tasks')
router.register(r'task-files',           views.TaskFilesViewSet,            basename='task-files')
router.register(r'task-blockers',        views.TaskBlockersViewSet,         basename='task-blockers')
router.register(r'task-labels',          views.TaskLabelViewSet,            basename='task-labels')
router.register(r'task-comments',        views.TaskCommentViewSet,          basename='task-comments')
router.register(r'task-checklist',       views.TaskChecklistViewSet,        basename='task-checklist')
router.register(r'task-activity',        views.TaskActivityViewSet,         basename='task-activity')

urlpatterns = [
    path('dashboard-stats/', views.dashboard_stats, name='dashboard-stats'),
    path('admin-dashboard/', views.admin_dashboard, name='admin-dashboard'),
    path('my-dashboard/', views.my_dashboard, name='my-dashboard'),
    path('my-projects/', views.my_projects, name='my-projects'),
    path('projects/<int:pk>/progress/', views.project_progress, name='project-progress'),
] + router.urls
