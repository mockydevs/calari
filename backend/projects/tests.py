from django.contrib.auth import get_user_model
from unittest.mock import patch, MagicMock
import json
from types import SimpleNamespace
import uuid
import requests
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from .models import Clients, Projects, ProjectCoAssignment, TaskComment, Tasks, projectBlockers
from .models import GhlConnection
from . import ghl


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

    def test_project_list_aggregates_without_loading_child_records(self):
        Tasks.objects.bulk_create([
            Tasks(project=self.project, name=f"Done {i}", status="done") for i in range(20)
        ])
        projectBlockers.objects.create(project=self.project, description="Open")
        projectBlockers.objects.create(project=self.project, description="Resolved", resolved=True)
        ProjectCoAssignment.objects.create(project=self.project, user=self.owner, role="lead")
        empty = Projects.objects.create(
            client=self.client_record, name="Empty", start_date="2026-01-01", end_date="2026-01-31", assigned_to=self.owner,
        )
        self.client.force_authenticate(self.owner)
        with self.assertNumQueries(3), patch.object(Tasks, "from_db") as task_load, patch.object(projectBlockers, "from_db") as blocker_load:
            response = self.client.get("/api/projects/my-projects/")
        self.assertEqual(response.status_code, 200)
        rows = {row["id"]: row for row in response.data}
        self.assertEqual(rows[self.project.id]["task_total"], 21)
        self.assertEqual(rows[self.project.id]["task_done"], 20)
        self.assertEqual(rows[self.project.id]["progress_percent"], 95)
        self.assertEqual(rows[self.project.id]["open_blockers"], 1)
        self.assertEqual(rows[empty.id]["task_total"], 0)
        self.assertEqual(rows[empty.id]["progress_percent"], 0)
        task_load.assert_not_called()
        blocker_load.assert_not_called()

    def test_project_list_preserves_member_visibility(self):
        self.client.force_authenticate(self.outsider)
        self.assertEqual(self.client.get("/api/projects/my-projects/").data, [])
        ProjectCoAssignment.objects.create(project=self.project, user=self.outsider, role="reviewer")
        response = self.client.get("/api/projects/my-projects/")
        self.assertEqual([row["id"] for row in response.data], [self.project.id])


class GhlConnectionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(username="ghl-admin", role="admin")
        cls.member = User.objects.create_user(username="ghl-member", role="employee", feature_permissions=["clients"])
        cls.account = Clients.objects.create(name="Test account", email="ghl@example.test")

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.url = f"/api/projects/clients/{self.account.pk}/ghl-connection/"
        self.test_url = f"/api/projects/clients/{self.account.pk}/ghl-test/"

    def save_connection(self, token="test-private-token", location="location123"):
        return self.client.put(self.url, {"location_id": location, "token": token}, format="json")

    def test_encrypted_write_only_storage_blank_preservation_and_disconnect(self):
        from builds.services import decrypt_api_key
        response = self.save_connection()
        self.assertEqual(response.status_code, 200)
        connection = GhlConnection.objects.get(client=self.account)
        self.assertNotIn("test-private-token", connection.encrypted_token)
        self.assertEqual(decrypt_api_key(connection.encrypted_token), "test-private-token")
        self.assertNotIn("token", json.dumps(response.data))
        self.assertNotIn(connection.encrypted_token, json.dumps(self.client.get(f"/api/projects/clients/{self.account.pk}/").data))
        self.assertEqual(self.save_connection(token="").status_code, 200)
        self.assertEqual(GhlConnection.objects.get(pk=connection.pk).encrypted_token, connection.encrypted_token)
        self.assertEqual(self.save_connection(token="", location="other").status_code, 400)
        self.assertEqual(self.save_connection(token="new-private-token").status_code, 200)
        self.assertNotEqual(GhlConnection.objects.get(pk=connection.pk).revision, connection.revision)
        self.assertEqual(self.client.delete(self.url).status_code, 204)
        self.assertFalse(GhlConnection.objects.exists())
        self.account.refresh_from_db()
        self.assertEqual(self.account.ghl_location_id, "")

    def test_member_with_clients_grant_cannot_manage_or_test_credentials(self):
        self.save_connection()
        self.client.force_authenticate(self.member)
        with patch("projects.ghl.inventory") as fetch:
            for method in ("get", "delete", "put"):
                self.assertEqual(getattr(self.client, method)(self.url, {}, format="json").status_code, 403)
            self.assertEqual(self.client.post(self.test_url).status_code, 403)
            fetch.assert_not_called()
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(self.url).status_code, (401, 403))

    def test_invalid_input_missing_connection_and_legacy_location_change(self):
        self.assertEqual(self.client.post(self.test_url).status_code, 400)
        for location in ("https://evil.test", "../contacts", "hello\nworld"):
            self.assertEqual(self.save_connection(location=location).status_code, 400)
        self.assertEqual(self.save_connection(token="bad\r\nheader").status_code, 400)
        self.assertEqual(self.save_connection(token="").status_code, 400)
        self.save_connection()
        self.assertEqual(self.client.patch(f"/api/projects/clients/{self.account.pk}/", {"ghl_location_id": "other"}, format="json").status_code, 400)

    def test_cached_safe_results_partial_scopes_and_rotation_invalidation(self):
        self.save_connection()
        result = {"account": "Test account", "ok": False, "checks": [
            {"area": "tags", "ok": True, "returned": 1, "names": ["Internal tag"]},
            {"area": "forms", "ok": False, "error": "Missing scope"},
        ]}
        with patch("projects.ghl.inventory", return_value=result) as fetch:
            response = self.client.post(self.test_url)
            self.assertEqual(response.status_code, 200)
            self.assertFalse(response.data["last_check"]["ok"])
            self.assertNotIn("Internal tag", json.dumps(response.data))
            self.assertEqual(self.client.post(self.test_url).data, response.data)
            fetch.assert_called_once_with("test-private-token", "location123")
        self.save_connection(token="replacement-token")
        connection = GhlConnection.objects.get(client=self.account)
        self.assertIsNone(connection.checked_at)
        self.assertEqual(connection.last_check, {})

    def test_stale_test_cannot_update_replaced_connection(self):
        self.save_connection()
        def replace(*args):
            GhlConnection.objects.filter(client=self.account).update(revision=uuid.uuid4())
            return {"ok": True, "checks": []}
        with patch("projects.ghl.inventory", side_effect=replace):
            self.assertEqual(self.client.post(self.test_url).status_code, 409)
        self.assertIsNone(GhlConnection.objects.get(client=self.account).checked_at)

    def test_expired_token_and_corrupt_secret_have_safe_results(self):
        self.save_connection()
        with patch("projects.ghl.inventory", side_effect=ghl.GhlError("GHL rejected the token.")):
            response = self.client.post(self.test_url)
        self.assertFalse(response.data["last_check"]["ok"])
        GhlConnection.objects.filter(client=self.account).update(encrypted_token="corrupt", checked_at=None)
        with patch("projects.ghl.inventory") as fetch:
            response = self.client.post(self.test_url)
            fetch.assert_not_called()
        self.assertIn("cannot be decrypted", response.data["last_check"]["error"])
        self.assertNotIn("corrupt", json.dumps(response.data))

    def test_read_only_inventory_rejects_wrong_location_and_preserves_partial_failure(self):
        def respond(token, path, params=None):
            if path == "/locations/location123":
                return {"location": {"id": "location123", "name": "Test"}}
            if path == "/forms/":
                raise ghl.GhlError("GHL denied access.")
            if path == "/workflows/":
                return {"workflows": [{"name": "Wrong account", "locationId": "other"}]}
            if path.endswith("tags"):
                return {"tags": [{"name": f"Tag {n}", "locationId": "location123"} for n in range(62)]}
            return {"pipelines": []}
        with patch("projects.ghl._get", side_effect=respond) as fetch:
            result = ghl.inventory("token", "location123")
        self.assertEqual(fetch.call_count, 5)
        self.assertFalse(result["ok"])
        self.assertEqual(len(result["checks"][1]["names"]), 50)
        self.assertTrue(result["checks"][1]["limited"])
        self.assertFalse(result["checks"][2]["ok"])
        self.assertFalse(result["checks"][3]["ok"])
        self.assertNotIn("Wrong account", json.dumps(result))
        with patch("projects.ghl._get", return_value={"location": {"id": "other"}}) as fetch:
            with self.assertRaises(ghl.GhlError):
                ghl.inventory("token", "location123")
            self.assertEqual(fetch.call_count, 1)

    def test_transport_uses_fixed_host_no_redirects_and_bounded_safe_errors(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.status_code = 200
        response.iter_content.return_value = [b'{"location": {"id": "location123", "name": "Test"}}']
        with patch("projects.ghl.requests.get", return_value=response) as get:
            self.assertEqual(ghl.identity("private-token", "location123"), "Test")
            args, kwargs = get.call_args
            self.assertEqual(args[0], "https://services.leadconnectorhq.com/locations/location123")
            self.assertFalse(kwargs["allow_redirects"])
            self.assertEqual(kwargs["timeout"], (3, 7))
            self.assertEqual(kwargs["headers"]["Version"], "2021-07-28")
        for code in (301, 401, 403, 404, 429, 500):
            response.status_code = code
            with patch("projects.ghl.requests.get", return_value=response):
                with self.assertRaises(ghl.GhlError):
                    ghl.identity("private-token", "location123")
        for failure in (requests.Timeout("private-token"), requests.ConnectionError("private-token")):
            with patch("projects.ghl.requests.get", side_effect=failure):
                with self.assertRaises(ghl.GhlError) as caught:
                    ghl.identity("private-token", "location123")
                self.assertNotIn("private-token", str(caught.exception))
        response.status_code = 200
        for body in (b'not json', b'x' * (ghl.MAX_BYTES + 1), b'[]'):
            response.iter_content.return_value = [body]
            with patch("projects.ghl.requests.get", return_value=response):
                with self.assertRaises(ghl.GhlError):
                    ghl.identity("private-token", "location123")

    def test_build_inventory_uses_only_its_clients_token_without_ai_or_mcp(self):
        from builds.services import ghl_state_snapshot
        self.save_connection()
        build = SimpleNamespace(client_id=self.account.id)
        with patch("projects.ghl.inventory", return_value={"ok": True, "checks": []}) as fetch, patch("builds.services._chat") as chat:
            self.assertIn('"ok": true', ghl_state_snapshot(build))
            fetch.assert_called_once_with("test-private-token", "location123")
            chat.assert_not_called()
            self.assertEqual(ghl_state_snapshot(SimpleNamespace(client_id=None)), "")
            other = Clients.objects.create(name="Unconnected", email="other@example.test")
            self.assertEqual(ghl_state_snapshot(SimpleNamespace(client_id=other.id)), "")
            self.assertEqual(fetch.call_count, 1)

    def test_onboarding_populates_business_details_and_is_idempotent(self):
        details = {"name": "Dental Business", "email": "office@dental.example", "phone": "+15555550123", "website": "https://dental.example", "city": "Test city"}
        with patch("projects.ghl.location_details", return_value=details):
            response = self.client.post("/api/projects/clients/onboard-ghl/", {"token": "new-token", "location_id": "dental123"}, format="json")
            self.assertEqual(response.status_code, 201)
            client = Clients.objects.get(pk=response.data["client_id"])
            self.assertEqual((client.name, client.company_name, client.email, client.phone_number), (details["name"], details["name"], details["email"], details["phone"]))
            connection = GhlConnection.objects.get(client=client)
            self.assertEqual(connection.business_details["website"], details["website"])
            again = self.client.post("/api/projects/clients/onboard-ghl/", {"token": "new-token", "location_id": "dental123"}, format="json")
            self.assertEqual(again.data["client_id"], client.pk)
            self.assertFalse(again.data["created"])
            self.assertEqual(GhlConnection.objects.count(), 1)

    def test_onboarding_handles_missing_email_without_inventing_details(self):
        with patch("projects.ghl.location_details", return_value={"name": "No email"}):
            for location in ("location1", "location2"):
                response = self.client.post("/api/projects/clients/onboard-ghl/", {"token": "token", "location_id": location}, format="json")
                self.assertEqual(response.status_code, 201)
                self.assertIsNone(Clients.objects.get(pk=response.data["client_id"]).email)

    def test_onboarding_does_not_merge_different_locations_by_email_or_write_on_failure(self):
        with patch("projects.ghl.location_details", return_value={"name": "Other", "email": self.account.email}):
            response = self.client.post("/api/projects/clients/onboard-ghl/", {"token": "token", "location_id": "other"}, format="json")
            self.assertEqual(response.status_code, 400)
        with patch("projects.ghl.location_details", side_effect=ghl.GhlError("Wrong location")):
            response = self.client.post("/api/projects/clients/onboard-ghl/", {"token": "token", "location_id": "other"}, format="json")
            self.assertEqual(response.status_code, 400)
        self.assertEqual(Clients.objects.count(), 1)
        self.assertFalse(GhlConnection.objects.exists())
        self.client.force_authenticate(self.member)
        with patch("projects.ghl.location_details") as fetch:
            self.assertEqual(self.client.post("/api/projects/clients/onboard-ghl/", {"token": "token", "location_id": "other"}, format="json").status_code, 403)
            fetch.assert_not_called()
