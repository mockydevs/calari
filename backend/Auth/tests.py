from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

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
