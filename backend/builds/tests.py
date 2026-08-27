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

    @patch("builds.views.send_notification_email.delay")
    def test_completion_queues_check_without_network_and_cannot_spoof_verification(self, _email):
        from builds.models import Task
        task = Task.objects.create(build=self.build, title="Configure automation", assignee=self.employee)
        self.client.force_authenticate(self.employee)
        with patch("builds.ghl_verification.verification_snapshot") as inventory, patch("builds.services._chat") as chat:
            response = self.client.post(f"/api/builds/tasks/{task.pk}/status/", {"status": "DONE", "ghl_verification_status": "VERIFIED"}, format="json")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data["ghl_verification_status"], "PENDING")
            inventory.assert_not_called(); chat.assert_not_called()
        task.refresh_from_db(); revision = task.ghl_verification_revision
        self.client.post(f"/api/builds/tasks/{task.pk}/status/", {"status": "DONE"}, format="json")
        task.refresh_from_db(); self.assertEqual(task.ghl_verification_revision, revision)
        self.client.post(f"/api/builds/tasks/{task.pk}/status/", {"status": "IN_PROGRESS"}, format="json")
        task.refresh_from_db(); self.assertEqual(task.ghl_verification_status, "")
        self.assertNotEqual(task.ghl_verification_revision, revision)

    def test_completion_review_is_not_proof_and_notifies_staff_only_once(self):
        from builds.models import Task, Notification
        from builds.serializers import TaskSerializer
        from builds.ghl_verification import verify
        from projects.models import GhlConnection
        task = Task.objects.create(build=self.build, title="Configure automation", assignee=self.employee)
        GhlConnection.objects.create(client=self.client_record, location_id="testloc", encrypted_token=services.encrypt_api_key("test-token")[0])
        serializer = TaskSerializer(task, data={"status": "DONE"}, partial=True)
        serializer.is_valid(raise_exception=True); serializer.save()
        result = {"ok": True, "checks": [{"area": "workflows", "ok": True, "returned": 2, "names": ["Flow one"]}]}
        with patch("builds.ghl_verification.verification_snapshot", return_value=result) as fetch, patch("builds.ghl_verification._interpret", return_value="Test trigger paths and the exit conditions."):
            self.assertTrue(verify(task.pk))
            self.assertFalse(verify(task.pk))
            self.assertEqual(fetch.call_args.args[0].location_id, "testloc")
        task.refresh_from_db()
        self.assertEqual(task.status, "DONE")
        self.assertEqual(task.ghl_verification_status, "NEEDS_EVIDENCE")
        self.assertIn("not verified", task.ghl_verification_note)
        self.assertIn("Test trigger paths", task.ghl_verification_note)
        self.assertEqual(list(Notification.objects.values_list("user_id", flat=True)), [self.employee.pk])

    def test_completion_review_does_not_overwrite_reopened_work_or_use_another_clients_key(self):
        from builds.models import Task
        from builds.serializers import TaskSerializer
        from builds.ghl_verification import verify
        from projects.models import GhlConnection
        task = Task.objects.create(build=self.build, title="Flow", assignee=self.employee)
        connection = GhlConnection.objects.create(client=self.client_record, location_id="testloc", encrypted_token=services.encrypt_api_key("test-token")[0])
        serializer = TaskSerializer(task, data={"status": "DONE"}, partial=True)
        serializer.is_valid(raise_exception=True); serializer.save()
        def reopen(*args):
            serializer = TaskSerializer(Task.objects.get(pk=task.pk), data={"status": "IN_PROGRESS"}, partial=True)
            serializer.is_valid(raise_exception=True); serializer.save()
            return {"ok": True, "checks": []}
        with patch("builds.ghl_verification.verification_snapshot", side_effect=reopen), patch("builds.ghl_verification._interpret", return_value=""):
            self.assertFalse(verify(task.pk))
        task.refresh_from_db(); self.assertEqual(task.ghl_verification_status, "")
        connection.delete()
        serializer = TaskSerializer(task, data={"status": "DONE"}, partial=True)
        serializer.is_valid(raise_exception=True); serializer.save()
        with patch("builds.ghl_verification.verification_snapshot") as fetch:
            self.assertTrue(verify(task.pk))
            fetch.assert_not_called()
        task.refresh_from_db(); self.assertEqual(task.ghl_verification_status, "NOT_CONNECTED")

    def test_verification_is_scoped_and_polling_is_lightweight(self):
        from builds.models import Task
        task = Task.objects.create(title="Private task", assignee=self.employee, creator=self.employee)
        other = get_user_model().objects.create_user(username="otherstaff", role="employee")
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get(f"/api/builds/tasks/{task.pk}/ghl-verification/").status_code, 404)
        self.client.force_authenticate(self.employee)
        with self.assertNumQueries(1):
            response = self.client.get(f"/api/builds/tasks/{task.pk}/ghl-verification/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.post(f"/api/builds/tasks/{task.pk}/ghl-verification/").status_code, 400)

    def test_completion_review_resolves_private_slack_channel_client(self):
        from builds.models import Task
        from builds.serializers import TaskSerializer
        from builds.ghl_verification import verify
        from projects.models import GhlConnection
        from onboarding.models import SlackChannel, SlackIntakeEvent, SlackWorkItem
        channel = SlackChannel.objects.create(channel_id="CVERIFY", name="Test", client=self.client_record)
        event = SlackIntakeEvent.objects.create(channel=channel, event_id="EVERIFY", message_ts="100.1", thread_ts="100.1", sender_id="U123", text="Test request")
        task = Task.objects.create(title="Private Slack check", assignee=self.employee)
        SlackWorkItem.objects.create(task=task, event=event, category="AUTOMATIONS")
        GhlConnection.objects.create(client=self.client_record, location_id="slackloc", encrypted_token=services.encrypt_api_key("slack-client-token")[0])
        serializer = TaskSerializer(task, data={"status": "DONE"}, partial=True)
        serializer.is_valid(raise_exception=True); serializer.save()
        with patch("builds.ghl_verification.verification_snapshot", return_value={"ok": True, "checks": []}) as fetch, patch("builds.ghl_verification._interpret", side_effect=RuntimeError("provider error")):
            self.assertTrue(verify(task.pk))
            self.assertEqual(fetch.call_args.args[0].location_id, "slackloc")
        task.refresh_from_db()
        self.assertEqual(task.ghl_verification_status, "NEEDS_EVIDENCE")
        self.assertIn("AI review unavailable", task.ghl_verification_note)

    def test_stale_processing_check_becomes_visible_failure(self):
        from datetime import timedelta
        from django.utils import timezone
        from builds.models import Task
        from builds.ghl_verification import drain
        task = Task.objects.create(title="Interrupted", status="DONE", ghl_verification_status="PROCESSING", ghl_verification_started_at=timezone.now() - timedelta(minutes=6))
        with patch("builds.ghl_verification.verification_snapshot") as fetch:
            self.assertEqual(drain(), 0)
            fetch.assert_not_called()
        task.refresh_from_db()
        self.assertEqual(task.ghl_verification_status, "ACCESS_ISSUE")

    def test_employee_cannot_create_admin_team_invite(self):
        self.client.force_authenticate(self.employee)

        res = self.client.post(
            "/api/builds/team-invites/",
            {"email": "new-admin@example.com", "name": "New Admin", "role": "admin"},
            format="json",
        )

        self.assertEqual(res.status_code, 403)
        self.assertFalse(TeamInvite.objects.filter(email="new-admin@example.com").exists())

    def test_retired_client_portal_routes_are_unavailable_and_tokens_not_serialized(self):
        self.assertEqual(self.client.get("/api/builds/portal/retired-token/build/").status_code, 404)
        self.assertEqual(self.client.post("/api/builds/portal/retired-token/feedback/", {"message": "not accepted"}).status_code, 404)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post(f"/api/builds/builds/{self.build.pk}/enable-portal/").status_code, 404)
        response = self.client.get(f"/api/builds/builds/{self.build.pk}/")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("client_portal_token", response.data)
        self.assertNotIn("client_portal_enabled", response.data)

    def test_retired_feedback_is_archived_in_internal_history(self):
        from importlib import import_module
        from types import SimpleNamespace
        from unittest.mock import MagicMock
        from django.utils import timezone
        from builds.models import Activity
        archive = import_module("builds.migrations.0021_remove_client_portal").archive_feedback
        feedback = MagicMock()
        feedback.objects.using.return_value.order_by.return_value.iterator.return_value = [
            SimpleNamespace(build_id=self.build.pk, created_at=timezone.now(), name="Former client", message="Please retain this feedback.")
        ]
        apps = MagicMock()
        apps.get_model.side_effect = lambda app, model: feedback if model == "ClientPortalFeedback" else Activity
        archive(apps, SimpleNamespace(connection=SimpleNamespace(alias="default")))
        record = Activity.objects.get(build=self.build)
        self.assertIn("Former client", record.message)
        self.assertIn("Please retain this feedback.", record.message)

    @patch("builds.views.send_notification_email.delay")
    def test_admin_creates_standalone_assignment_and_employee_completes_it(self, _send):
        from builds.models import Task, Notification
        self.client.force_authenticate(self.admin)
        response = self.client.post("/api/builds/tasks/", {
            "title": "Prepare the weekly report", "assignee": self.employee.id,
            "priority": "HIGH", "due_date": "2026-09-01T14:00:00Z",
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        task = Task.objects.get(pk=response.data["id"])
        self.assertIsNone(task.build_id)
        self.assertEqual(task.creator, self.admin)
        self.assertEqual(task.priority, "HIGH")
        self.assertTrue(Notification.objects.filter(user=self.employee, type="TASK_ASSIGNED", link="/tasks").exists())
        self.client.force_authenticate(self.employee)
        dashboard = self.client.get("/api/projects/my-dashboard/")
        self.assertEqual(dashboard.status_code, 200, dashboard.data)
        result = self.client.post(f"/api/builds/tasks/{task.id}/status/", {"status": "DONE"}, format="json")
        self.assertEqual(result.status_code, 200, result.data)
        task.refresh_from_db()
        self.assertEqual(task.status, "DONE")
        dashboard = self.client.get("/api/projects/my-dashboard/")
        self.assertEqual(dashboard.status_code, 200, dashboard.data)

    def test_staff_cannot_create_reassign_or_delete_tasks(self):
        from builds.models import Task
        task = Task.objects.create(title="Assigned", creator=self.admin, assignee=self.employee)
        self.client.force_authenticate(self.employee)
        self.assertEqual(self.client.post("/api/builds/tasks/", {"title": "Unauthorized"}, format="json").status_code, 403)
        self.assertEqual(self.client.patch(f"/api/builds/tasks/{task.id}/", {"assignee": self.admin.id}, format="json").status_code, 403)
        self.assertEqual(self.client.delete(f"/api/builds/tasks/{task.id}/").status_code, 403)

    def test_staff_cannot_read_another_persons_internal_task_or_write_foreign_build_task(self):
        from builds.models import Task
        internal = Task.objects.create(title="Private internal", creator=self.admin, assignee=self.admin)
        self.client.force_authenticate(self.employee)
        self.assertEqual(self.client.get(f"/api/builds/tasks/{internal.id}/").status_code, 404)
        self.build.assignee = self.admin
        self.build.save()
        foreign = Task.objects.create(title="Other build", build=self.build, assignee=self.admin)
        self.assertEqual(self.client.post(f"/api/builds/tasks/{foreign.id}/status/", {"status": "DONE"}, format="json").status_code, 403)

    def test_task_validation_and_filtered_counts(self):
        from builds.models import Task
        self.client.force_authenticate(self.admin)
        task = Task.objects.create(title="Review report", assignee=self.employee, priority="HIGH")
        self.assertEqual(self.client.post(f"/api/builds/tasks/{task.id}/status/", {"status": "INVALID"}, format="json").status_code, 400)
        self.employee.is_active = False
        self.employee.save()
        invalid = self.client.post("/api/builds/tasks/", {"title": "Invalid staff", "assignee": self.employee.id}, format="json")
        self.assertEqual(invalid.status_code, 400)
        Task.objects.create(title="Unrelated", build=self.build, status="DONE")
        summary = self.client.get("/api/builds/tasks/summary/?kind=general&search=report")
        self.assertEqual(summary.status_code, 200, summary.data)
        self.assertEqual(summary.data["total"], 1)
        self.assertEqual(summary.data["done"], 0)

    def test_task_list_avoids_fetching_detail_relations(self):
        from builds.models import Task, Comment
        self.client.force_authenticate(self.admin)
        tasks = [Task.objects.create(title=f"Task {i}", build=self.build, assignee=self.employee) for i in range(8)]
        for task in tasks:
            Comment.objects.create(task=task, author=self.admin, body="Detail only")
        # One page count + one joined task query, independent of task/comment count.
        with self.assertNumQueries(2):
            response = self.client.get("/api/builds/tasks/?page_size=6")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 8)
        self.assertEqual(len(response.data["results"]), 6)
        self.assertIsNotNone(response.data["next"])
        self.assertEqual(response.data["results"][0]["client_name"], self.client_record.name)
        detail = self.client.get(f"/api/builds/tasks/{tasks[0].id}/")
        self.assertEqual(detail.data["comments"][0]["body"], "Detail only")

    def test_task_page_size_is_bounded(self):
        from builds.models import Task
        self.client.force_authenticate(self.admin)
        Task.objects.bulk_create([Task(title=f"Task {i}", creator=self.admin) for i in range(105)])
        response = self.client.get("/api/builds/tasks/?page_size=10000")
        self.assertEqual(len(response.data["results"]), 100)
        self.assertEqual(response.data["count"], 105)

    def test_unread_summary_is_small_and_scoped_to_current_user(self):
        from builds.models import Notification
        self.client.force_authenticate(self.employee)
        Notification.objects.bulk_create([
            Notification(user=self.employee, type="TASK_ASSIGNED", message=f"Item {i}") for i in range(105)
        ])
        latest = Notification.objects.create(user=self.employee, type="TASK_ASSIGNED", message="Newest unread")
        Notification.objects.create(user=self.employee, type="TASK_ASSIGNED", message="Already read", read=True)
        Notification.objects.create(user=self.admin, type="TASK_ASSIGNED", message="Private admin message")
        with self.assertNumQueries(2):
            response = self.client.get("/api/builds/notifications/unread-summary/?user=1")
        self.assertEqual(response.data, {"count": 106, "latest": {"id": latest.id, "message": "Newest unread"}})
        self.client.post("/api/builds/notifications/mark-all-read/")
        empty = self.client.get("/api/builds/notifications/unread-summary/")
        self.assertEqual(empty.data, {"count": 0, "latest": None})
        self.client.force_authenticate(user=None)
        self.assertIn(self.client.get("/api/builds/notifications/unread-summary/").status_code, (401, 403))

    def test_ghl_review_publishes_each_category_once_and_syncs_completion(self):
        from builds.models import MeetingActionItem, Task
        self.client.force_authenticate(self.admin)
        mapping = {"AUTOMATIONS": "AUTOMATION", "PIPELINE": "PIPELINE", "FIELDS_TAGS": "TAG", "FUNNELS": "FUNNEL", "FORMS_PAYMENTS": "FORM", "EMAIL_COPY": "EMAIL"}
        items = [MeetingActionItem.objects.create(build=self.build, text=f"Implement {section}", section=section, ai_generated=True) for section in mapping]
        payload = {"build": self.build.id, "items": [{"id": item.id, "assignee": self.employee.id, "priority": "HIGH", "due_date": "2026-09-07T14:00:00Z"} for item in items]}
        response = self.client.post("/api/builds/action-items/publish/", payload, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 6)
        retry = self.client.post("/api/builds/action-items/publish/", payload, format="json")
        self.assertEqual(retry.data["created"], 0)
        for item in items:
            item.refresh_from_db()
            self.assertTrue(item.locked)
            self.assertEqual(item.assigned_task.type, mapping[item.section])
            self.assertEqual(item.assigned_task.priority, "HIGH")
            self.assertEqual(item.assigned_task.due_date.isoformat(), "2026-09-07T14:00:00+00:00")
        task = Task.objects.get(source_item=items[0])
        with patch("builds.views.send_notification_email.delay"):
            self.client.force_authenticate(self.employee)
            status = self.client.post(f"/api/builds/tasks/{task.id}/status/", {"status": "DONE"}, format="json")
        self.assertEqual(status.status_code, 200, status.data)
        items[0].refresh_from_db()
        self.assertEqual(items[0].status, "DONE")

    def test_ghl_publish_is_atomic_and_manager_only(self):
        from builds.models import MeetingActionItem, Task
        good = MeetingActionItem.objects.create(build=self.build, text="Create landing page", section="FUNNELS")
        question = MeetingActionItem.objects.create(build=self.build, text="Which domain?", category="QUESTION")
        payload = {"build": self.build.id, "items": [{"id": item.id, "assignee": self.employee.id} for item in (good, question)]}
        self.client.force_authenticate(self.employee)
        self.assertEqual(self.client.post("/api/builds/action-items/publish/", payload, format="json").status_code, 403)
        self.client.force_authenticate(self.admin)
        response = self.client.post("/api/builds/action-items/publish/", payload, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Task.objects.filter(build=self.build).exists())
        good.refresh_from_db()
        self.assertFalse(good.locked)

    def test_assigned_meeting_items_survive_ai_resync_and_reject_direct_edits(self):
        from builds.models import MeetingActionItem, Task
        from builds.tasks import _apply_tasklist_delta
        item = MeetingActionItem.objects.create(build=self.build, text="Write welcome email", section="EMAIL_COPY", locked=True)
        Task.objects.create(build=self.build, title=item.text, source_item=item)
        _apply_tasklist_delta(self.build, {"modify": [{"id": item.id, "text": "Overwrite"}], "supersede": [{"id": item.id, "reason": "AI removed"}]}, None)
        item.refresh_from_db()
        self.assertFalse(item.superseded)
        self.assertEqual(item.text, "Write welcome email")
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.patch(f"/api/builds/action-items/{item.id}/", {"text": "Overwrite"}, format="json").status_code, 400)
        self.assertEqual(self.client.delete(f"/api/builds/action-items/{item.id}/").status_code, 400)

    def test_extraction_persists_and_exports_new_ghl_sections(self):
        from builds.tasks import _apply_tasklist_full
        from builds.models import MeetingNote
        note = MeetingNote.objects.create(build=self.build, raw_text="Create a landing page and write welcome email copy.")
        _apply_tasklist_full(self.build, [
            {"text": "Create a landing page", "section": "FUNNELS", "category": "REQUEST"},
            {"text": "Write welcome email copy", "section": "EMAIL_COPY", "category": "REQUEST"},
        ], note)
        markdown = services.render_tasklist_markdown(self.build)
        self.assertIn("Funnels", markdown)
        self.assertIn("Email copy", markdown)
        self.assertEqual(set(self.build.action_items.values_list("section", flat=True)), {"FUNNELS", "EMAIL_COPY"})

    @patch("builds.services.build_reference_context", return_value="")
    @patch("builds.services._chat", return_value='{"items":[{"text":"Write welcome email","detail":"Use a friendly tone","category":"REQUEST","section":"EMAIL_COPY"}]}')
    def test_meeting_analysis_runs_through_provider_schema_and_persists_drafts(self, chat, _reference):
        from builds.models import MeetingNote, Task
        from builds.tasks import generate_meeting_tasklist
        note = MeetingNote.objects.create(build=self.build, raw_text="Write a friendly welcome email.")
        generate_meeting_tasklist.run(self.build.id, note.id, self.admin.id)
        self.build.refresh_from_db()
        self.assertEqual(self.build.tasklist_status, "done")
        item = self.build.action_items.get()
        self.assertEqual(item.section, "EMAIL_COPY")
        self.assertFalse(Task.objects.filter(build=self.build).exists())  # review is required
        schema = chat.call_args.kwargs["response_format"]["json_schema"]["schema"]
        self.assertIn("EMAIL_COPY", schema["properties"]["items"]["items"]["properties"]["section"]["enum"])

    @patch("builds.services.build_reference_context", side_effect=RuntimeError("Provider unavailable"))
    def test_analysis_failure_leaves_retryable_status(self, _reference):
        from builds.models import MeetingNote
        from builds.tasks import generate_meeting_tasklist
        note = MeetingNote.objects.create(build=self.build, raw_text="Create a form.")
        generate_meeting_tasklist.run(self.build.id, note.id, self.admin.id)
        self.build.refresh_from_db()
        self.assertEqual(self.build.tasklist_status, "failed")

    def test_builds_manager_has_minimal_staff_roster_without_team_admin_access(self):
        self.employee.feature_permissions = ["builds_manage"]
        self.employee.save()
        self.client.force_authenticate(self.employee)
        response = self.client.get("/api/builds/tasks/assignees/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn(self.admin.id, [row["id"] for row in response.data])
        self.assertNotIn("email", response.data[0])

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

    def test_removed_ai_providers_rejected_by_key_and_config_apis(self):
        self.client.force_authenticate(self.admin)
        for provider in ("GOOGLE", "GROQ", "MISTRAL", "OPENROUTER", "OTHER"):
            with self.subTest(provider=provider):
                response = self.client.post("/api/builds/ai-keys/", {"provider": provider, "label": "Not supported", "api_key": "test-only"}, format="json")
                self.assertEqual(response.status_code, 400)
                self.assertIn("provider", response.data)
                self.assertEqual(self.client.patch("/api/builds/ai-config/", {"provider": provider}, format="json").status_code, 400)
        self.assertFalse(AiApiKey.objects.exists())

    @patch("builds.services.encrypt_api_key", return_value=("encrypted-test-only", "test-preview"))
    def test_openai_and_claude_keys_and_config_remain_supported(self, _encrypt):
        self.client.force_authenticate(self.admin)
        for provider in ("OPENAI", "ANTHROPIC"):
            response = self.client.post("/api/builds/ai-keys/", {"provider": provider, "label": provider, "api_key": "test-only"}, format="json")
            self.assertEqual(response.status_code, 201)
            self.assertNotIn("encrypted_key", response.data)
            self.assertEqual(self.client.patch("/api/builds/ai-config/", {"provider": provider}, format="json").status_code, 200)

    def test_legacy_ai_key_is_hidden_and_cannot_be_reactivated_or_used(self):
        key = AiApiKey.objects.create(provider="GOOGLE", label="Legacy", encrypted_key="encrypted-test", key_preview="legacy", active=True, created_by=self.admin)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get("/api/builds/ai-keys/").data["count"], 0)
        self.assertEqual(self.client.post(f"/api/builds/ai-keys/{key.pk}/activate/").status_code, 404)
        self.assertEqual(self.client.patch(f"/api/builds/ai-keys/{key.pk}/", {"active": True}, format="json").status_code, 404)
        self.assertIsNone(services.get_active_provider_key("GOOGLE"))

    def test_provider_retirement_keeps_credentials_and_resets_only_unsupported_config(self):
        from importlib import import_module
        from types import SimpleNamespace
        from django.apps import apps
        from builds.models import AiConfig
        retire = import_module("builds.migrations.0022_limit_ai_providers").retire_unsupported_providers
        legacy = AiApiKey.objects.create(provider="GROQ", label="Legacy", encrypted_key="retain-ciphertext", key_preview="legacy", active=True, created_by=self.admin)
        supported = AiApiKey.objects.create(provider="ANTHROPIC", label="Claude", encrypted_key="retain-claude", key_preview="claude", active=True, created_by=self.admin)
        config = AiConfig.objects.create(pk=1, provider="GROQ", model="legacy-model", blueprint_model="legacy-blueprint")
        retire(apps, SimpleNamespace(connection=SimpleNamespace(alias="default")))
        legacy.refresh_from_db(); supported.refresh_from_db(); config.refresh_from_db()
        self.assertFalse(legacy.active)
        self.assertEqual(legacy.encrypted_key, "retain-ciphertext")
        self.assertTrue(supported.active)
        self.assertEqual((config.provider, config.model, config.blueprint_model), ("OPENAI", "", ""))
        config.provider = "ANTHROPIC"
        config.model = "chosen-claude-model"
        config.save()
        retire(apps, SimpleNamespace(connection=SimpleNamespace(alias="default")))
        config.refresh_from_db()
        self.assertEqual((config.provider, config.model), ("ANTHROPIC", "chosen-claude-model"))

    def test_unsupported_env_provider_does_not_silently_use_openai(self):
        with patch("builds.services._ai_config", return_value=None), patch.dict("os.environ", {"AI_PROVIDER": "GOOGLE"}):
            with self.assertRaisesMessage(ValueError, "Choose OpenAI or Anthropic Claude"):
                services._active_provider()

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
        self.assertEqual(get_res.status_code, 200)
        self.assertEqual(get_res.data["markdown"], "")
        _generate.assert_not_called()
        post_res = self.client.post(f"/api/builds/builds/{self.build.id}/build-document/", {}, format="json")

        _generate.assert_called_once()
        self.assertEqual(post_res.status_code, 200)
        self.assertEqual(post_res.data["markdown"], "# Builder doc")
