from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from builds import services
from builds.models import AiApiKey, Build, BuildStatus, Document, TeamInvite
from projects.models import Clients


class RelevanceScoreTests(SimpleTestCase):
    """Pure-function tests for the Build Library relevance ranker — no DB needed."""

    def test_tokenize_drops_stopwords_and_short_words(self):
        toks = services._ref_tokenize("The dental SMS build for our clients")
        self.assertIn("dental", toks)
        self.assertIn("sms", toks)
        # stopwords + <=2-char words removed
        self.assertNotIn("the", toks)
        self.assertNotIn("for", toks)
        self.assertNotIn("our", toks)
        self.assertNotIn("build", toks)  # in _REF_STOPWORDS

    def test_score_counts_distinct_overlap(self):
        q = services._ref_tokenize("dental patient acquisition sms reminders")
        self.assertEqual(services.relevance_score("Dental patient SMS reminders flow", q), 4)
        self.assertEqual(services.relevance_score("recruitment pipeline candidate intake", q), 0)

    def test_empty_query_scores_zero(self):
        self.assertEqual(services.relevance_score("anything at all", set()), 0)

    def test_ordinal(self):
        self.assertEqual([services.ordinal(n) for n in (1, 2, 3, 4, 11, 12, 13, 21, 22)],
                         ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"])


class BuildSecurityRegressionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.admin = User.objects.create_user(
            username="admin", email="admin@example.com", password="Pass12345!", role="admin",
        )
        self.employee = User.objects.create_user(
            username="employee", email="employee@example.com", password="Pass12345!", role="employee",
        )
        self.client_record = Clients.objects.create(name="Acme", email="acme@example.com")
        self.build = Build.objects.create(
            title="Acme GHL",
            client=self.client_record,
            creator=self.admin,
            assignee=self.employee,
            status=BuildStatus.DRAFT,
        )

    def test_employee_cannot_create_admin_team_invite(self):
        self.client.force_authenticate(self.employee)

        res = self.client.post(
            "/api/builds/team-invites/",
            {"email": "new-admin@example.com", "name": "New Admin", "role": "admin"},
            format="json",
        )

        self.assertEqual(res.status_code, 403)
        self.assertFalse(TeamInvite.objects.filter(email="new-admin@example.com").exists())

    def test_employee_cannot_manage_ai_keys(self):
        key = AiApiKey.objects.create(
            provider="OPENAI",
            label="Prod",
            encrypted_key="iv:tag:ciphertext",
            key_preview="sk-...test",
            active=False,
            created_by=self.admin,
        )
        self.client.force_authenticate(self.employee)

        list_res = self.client.get("/api/builds/ai-keys/")
        activate_res = self.client.post(f"/api/builds/ai-keys/{key.id}/activate/")

        self.assertEqual(list_res.status_code, 403)
        self.assertEqual(activate_res.status_code, 403)
        key.refresh_from_db()
        self.assertFalse(key.active)

    @patch("builds.views.send_notification_email.delay")
    def test_approve_build_does_not_crash_when_no_vision_gaps_exist(self, _send):
        self.client.force_authenticate(self.admin)

        res = self.client.post(
            f"/api/builds/builds/{self.build.id}/approve/",
            {"assignee_id": self.employee.id},
            format="json",
        )

        self.assertEqual(res.status_code, 200)
        self.build.refresh_from_db()
        self.assertEqual(self.build.status, BuildStatus.ASSIGNED)

    @patch("builds.services.validate_uploaded_object", return_value=(False, "Uploaded object was not found in storage."))
    def test_upload_finalize_rejects_unverified_storage_key(self, _validate):
        self.client.force_authenticate(self.employee)

        res = self.client.post(
            "/api/builds/upload/finalize/",
            {
                "build": self.build.id,
                "filename": "evidence.pdf",
                "content_type": "application/pdf",
                "size_bytes": 123,
                "key": "uploads/missing.pdf",
            },
            format="json",
        )

        self.assertEqual(res.status_code, 400)
        self.assertFalse(Document.objects.filter(filename="evidence.pdf").exists())

    @patch("builds.views.services.generate_build_document", return_value="# Builder doc")
    def test_build_document_generation_requires_post(self, _generate):
        self.client.force_authenticate(self.employee)

        get_res = self.client.get(f"/api/builds/builds/{self.build.id}/build-document/")
        post_res = self.client.post(f"/api/builds/builds/{self.build.id}/build-document/", {}, format="json")

        self.assertEqual(get_res.status_code, 405)
        self.assertEqual(post_res.status_code, 200)
        self.assertEqual(post_res.data["markdown"], "# Builder doc")
