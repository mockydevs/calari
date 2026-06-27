from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from .models import Clients, Projects, TaskComment, Tasks, projectBlockers


User = get_user_model()


class ProjectPermissionRegressionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            username="admin", email="admin-project@example.com", password="Pass12345!", role="admin",
        )
        self.owner = User.objects.create_user(
            username="owner", email="owner@example.com", password="Pass12345!", role="employee",
        )
        self.outsider = User.objects.create_user(
            username="outsider", email="outsider@example.com", password="Pass12345!", role="employee",
        )
        self.client_record = Clients.objects.create(name="Client", email="client@example.com")
        self.project = Projects.objects.create(
            client=self.client_record,
            name="Private Project",
            start_date="2026-01-01",
            end_date="2026-01-31",
            assigned_to=self.owner,
        )
        self.task = Tasks.objects.create(
            project=self.project,
            name="Private Task",
            assigned_to=self.owner,
            created_by=self.owner,
        )

    def test_outsider_cannot_create_project_blocker(self):
        self.client.force_authenticate(self.outsider)

        res = self.client.post(
            "/api/projects/project-blockers/",
            {"project": self.project.id, "description": "Blocker"},
            format="json",
        )

        self.assertEqual(res.status_code, 403)
        self.assertFalse(projectBlockers.objects.filter(description="Blocker").exists())

    def test_project_owner_can_create_project_blocker(self):
        self.client.force_authenticate(self.owner)

        res = self.client.post(
            "/api/projects/project-blockers/",
            {"project": self.project.id, "description": "Owner blocker"},
            format="json",
        )

        self.assertEqual(res.status_code, 201)
        self.assertTrue(projectBlockers.objects.filter(description="Owner blocker").exists())

    def test_outsider_cannot_comment_on_task(self):
        self.client.force_authenticate(self.outsider)

        res = self.client.post(
            "/api/projects/task-comments/",
            {"task": self.task.id, "content": "Should not write"},
            format="json",
        )

        self.assertEqual(res.status_code, 403)
        self.assertFalse(TaskComment.objects.filter(content="Should not write").exists())
