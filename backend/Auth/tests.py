from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.conf import settings
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from builds.models import Build, Task
from projects.models import Clients, Projects

from .models import PasswordResetToken


User = get_user_model()


class PasswordResetSecurityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="staff",
            email="staff@example.com",
            password="OriginalPass123!",
            role="employee",
        )

    @patch("Auth.views.send_notification_email.delay")
    def test_forgot_password_does_not_change_existing_password(self, _send):
        res = self.client.post("/api/auth/forgot-password/", {"email": self.user.email}, format="json")

        self.assertEqual(res.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("OriginalPass123!"))
        self.assertEqual(PasswordResetToken.objects.filter(user=self.user, used=False).count(), 1)


class StaffRemovalTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(username="admin", role="admin")
        cls.staff = User.objects.create_user(
            username="employee", role="employee", password="StaffPass123!",
        )
        cls.superuser = User.objects.create_superuser(username="owner", role="superuser")

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.url = f"/api/auth/users/{self.staff.pk}/delete/"

    def test_removal_hides_member_but_preserves_work_and_history(self):
        account = Clients.objects.create(name="Example client")
        build = Build.objects.create(title="Build", client=account, creator=self.staff, assignee=self.staff)
        task = Task.objects.create(title="Task", build=build, creator=self.staff, assignee=self.staff)
        project = Projects.objects.create(
            name="Project", client=account, assigned_to=self.staff,
            start_date="2026-08-01", end_date="2026-08-31",
        )

        response = self.client.delete(self.url)

        self.assertEqual(response.status_code, 200)
        self.staff.refresh_from_db()
        self.assertFalse(self.staff.is_active)
        self.assertIsNotNone(self.staff.deleted_at)
        build.refresh_from_db()
        task.refresh_from_db()
        project.refresh_from_db()
        self.assertEqual(build.creator_id, self.staff.pk)
        self.assertEqual(task.assignee_id, self.staff.pk)
        self.assertEqual(project.assigned_to_id, self.staff.pk)
        listed = self.client.get("/api/auth/users/").json()
        self.assertNotIn(self.staff.pk, [user["id"] for user in listed])

    def test_deactivation_remains_visible_and_reversible(self):
        response = self.client.post(f"/api/auth/users/{self.staff.pk}/deactivate/")
        self.assertEqual(response.status_code, 200)
        self.staff.refresh_from_db()
        self.assertIsNone(self.staff.deleted_at)
        listed = self.client.get("/api/auth/users/").json()
        self.assertIn(self.staff.pk, [user["id"] for user in listed])
        response = self.client.post(f"/api/auth/users/{self.staff.pk}/activate/")
        self.assertEqual(response.status_code, 200)

    def test_inactive_member_can_be_removed(self):
        self.staff.is_active = False
        self.staff.save(update_fields=["is_active"])
        self.assertEqual(self.client.delete(self.url).status_code, 200)
        self.staff.refresh_from_db()
        self.assertIsNotNone(self.staff.deleted_at)

    def test_deleted_member_cannot_be_reactivated_or_edited(self):
        self.assertEqual(self.client.delete(self.url).status_code, 200)
        self.assertEqual(self.client.post(f"/api/auth/users/{self.staff.pk}/activate/").status_code, 404)
        self.assertEqual(self.client.patch(
            f"/api/auth/users/{self.staff.pk}/", {"is_active": True}, format="json",
        ).status_code, 404)
        self.assertEqual(self.client.post(f"/api/auth/users/{self.staff.pk}/deactivate/").status_code, 404)
        self.assertEqual(self.client.delete(self.url).status_code, 404)
        self.staff.refresh_from_db()
        self.assertFalse(self.staff.is_active)

    def test_cannot_delete_yourself(self):
        self.assertEqual(self.client.delete(f"/api/auth/users/{self.admin.pk}/delete/").status_code, 400)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_active)

    def test_team_feature_does_not_grant_delete_permission(self):
        self.staff.feature_permissions = ["team"]
        self.staff.save(update_fields=["feature_permissions"])
        self.client.force_authenticate(self.staff)
        response = self.client.delete(f"/api/auth/users/{self.admin.pk}/delete/")
        self.assertEqual(response.status_code, 403)

    def test_admin_cannot_delete_superuser(self):
        self.assertEqual(self.client.delete(f"/api/auth/users/{self.superuser.pk}/delete/").status_code, 403)

    def test_last_superuser_cannot_delete_self(self):
        self.client.force_authenticate(self.superuser)
        self.assertEqual(self.client.delete(f"/api/auth/users/{self.superuser.pk}/delete/").status_code, 400)

    def test_superuser_can_remove_another_superuser(self):
        other = User.objects.create_superuser(username="other-owner", role="superuser")
        self.client.force_authenticate(self.superuser)
        self.assertEqual(self.client.delete(f"/api/auth/users/{other.pk}/delete/").status_code, 200)
        self.superuser.refresh_from_db()
        self.assertTrue(self.superuser.is_active)

    def test_missing_user_returns_not_found(self):
        self.assertEqual(self.client.delete("/api/auth/users/999999/delete/").status_code, 404)

    def test_anonymous_request_cannot_delete(self):
        self.client.force_authenticate(user=None)
        self.assertIn(self.client.delete(self.url).status_code, (401, 403))

    def test_removed_member_cannot_sign_in_or_use_existing_access_token(self):
        access = str(RefreshToken.for_user(self.staff).access_token)
        self.assertEqual(self.client.delete(self.url).status_code, 200)
        anonymous = APIClient()
        response = anonymous.post("/api/token/", {
            "username_or_email": self.staff.username, "password": "StaffPass123!",
        }, format="json")
        self.assertIn(response.status_code, (401, 403))
        anonymous.cookies[settings.SIMPLE_JWT["AUTH_COOKIE"]] = access
        self.assertIn(anonymous.get("/api/auth/me/").status_code, (401, 403))
