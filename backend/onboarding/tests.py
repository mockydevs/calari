"""Tests for the onboarding-intelligence pipeline. External HTTP + AI calls are
mocked, so these run without real credentials or network."""
from unittest.mock import patch, MagicMock
import base64
import hashlib
import hmac
import json
import time

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient
from builds.models import Activity, Build, MeetingNote, Task
from projects.models import Clients
from onboarding.models import FathomMeeting, FathomRoutingRule, FathomSettings

from onboarding import integrations, services, oauth
from onboarding.tasks import _as_confidence
from onboarding import slack_intake
from onboarding.models import SlackChannel, SlackIntakeSettings, SlackIntakeEvent, SlackResponsibility, SlackTaskMessage, SlackWorkItem
from builds.models import Notification


class SlackIntakeTests(TestCase):
    url = "/api/onboarding/webhooks/slack/"
    root = "/api/onboarding/slack/"
    secret = "slack-test-signing-secret-not-live"

    @classmethod
    def setUpTestData(cls):
        user = get_user_model()
        cls.admin = user.objects.create_user(username="slack-admin", role="admin")
        cls.don = user.objects.create_user(username="don-test", full_name="Don", role="employee")
        cls.anita = user.objects.create_user(username="anita-test", full_name="Anita", role="employee")
        cls.other = user.objects.create_user(username="unassigned-test", role="employee")
        client = Clients.objects.create(name="Checkpilot test", email="checkpilot@example.test")
        cls.channel = SlackChannel.objects.create(channel_id="CTEST123", name="Checkpilot", client=client)
        SlackIntakeSettings.objects.create(pk=1, enabled=True, workspace_id="TTEST123", clare_user_id="UCLARE123", encrypted_signing_secret=services.encrypt_secret(cls.secret)[0])
        for category, person in [("AUTOMATION", cls.don), ("PIPELINE", cls.don), ("TAG", cls.don), ("FORM", cls.anita), ("FUNNEL", cls.anita)]:
            SlackResponsibility.objects.create(channel=cls.channel, category=category, assignee=person)

    def setUp(self):
        self.client = APIClient()

    def payload(self, number=1, text="<@UCLARE123> Please check the automation and signup form.", thread=None):
        event = {"type": "message", "channel_type": "channel", "channel": self.channel.channel_id, "user": "UCLIENT123", "ts": f"1787800000.{number:06d}", "text": text}
        if thread:
            event["thread_ts"] = thread
        return {"type": "event_callback", "team_id": "TTEST123", "event_id": f"EvTest{number}", "event": event}

    def signed_post(self, payload=None, stamp=None, signature=None):
        body = json.dumps(payload or self.payload(), ensure_ascii=False).encode()
        stamp = str(stamp or int(time.time()))
        digest = hmac.new(self.secret.encode(), f"v0:{stamp}:".encode() + body, hashlib.sha256).hexdigest()
        return self.client.post(self.url, data=body, content_type="application/json", HTTP_X_SLACK_REQUEST_TIMESTAMP=stamp, HTTP_X_SLACK_SIGNATURE=signature or "v0=" + digest)

    def analysis(self, *categories, confidence=.98, uncertain=False):
        return {"confidence": confidence, "uncertain": uncertain, "reason": "Client requests help.", "items": [{"category": category, "kind": "question", "title": f"Check {category.lower()}", "context": f"Explain the requested {category.lower()} behavior using the build context."} for category in categories]}

    def process(self, analysis=None):
        with patch("onboarding.slack_intake.analyze", return_value=analysis or self.analysis("AUTOMATION", "FORM")), patch("onboarding.integrations.slack_post") as outbound:
            slack_intake.process_channel(self.channel.pk)
            outbound.assert_not_called()

    def test_webhook_is_durable_without_ai_or_queue_and_deduplicates(self):
        with patch("onboarding.slack_intake._chat") as ai:
            self.assertEqual(self.signed_post().status_code, 200)
            self.assertTrue(self.signed_post().json()["duplicate"])
            payload = self.payload()
            payload["event_id"] = "EvAnotherDelivery"
            self.assertTrue(self.signed_post(payload).json()["duplicate"])
            ai.assert_not_called()
        self.assertEqual(SlackIntakeEvent.objects.count(), 1)
        self.assertFalse(Task.objects.exists())

    def test_bad_expired_and_future_signatures_are_rejected(self):
        now = 1787800000
        with patch("onboarding.slack_intake.time.time", return_value=now):
            for args in [{"signature": "v0=bad"}, {"stamp": now - 301}, {"stamp": now + 301}]:
                self.assertEqual(self.signed_post(**args).status_code, 401)
        self.assertFalse(SlackIntakeEvent.objects.exists())

    def test_signed_challenge_works_while_paused(self):
        SlackIntakeSettings.objects.filter(pk=1).update(enabled=False)
        self.assertEqual(self.signed_post({"type": "url_verification", "challenge": "test-challenge"}).json(), {"challenge": "test-challenge"})
        self.signed_post()
        self.assertFalse(SlackIntakeEvent.objects.exists())

    def test_unmapped_unmentioned_other_workspace_bots_edits_and_dms_ignored(self):
        for key, value in [("channel", "CUNMAPPED"), ("text", "Hello everyone"), ("bot_id", "BTEST"), ("channel_type", "im")]:
            payload = self.payload()
            payload["event"][key] = value
            self.assertEqual(self.signed_post(payload).status_code, 200)
        payload = self.payload()
        payload["team_id"] = "TOTHER"
        self.signed_post(payload)
        self.assertFalse(SlackIntakeEvent.objects.exists())

    def test_malformed_and_oversized_payloads_rejected(self):
        payload = self.payload()
        payload["event"]["ts"] = ["wrong"]
        self.assertEqual(self.signed_post(payload).status_code, 400)
        self.assertEqual(self.signed_post({"type": "url_verification", "challenge": "a" * slack_intake.MAX_BYTES}).status_code, 413)
        payload = self.payload()
        payload["event"]["subtype"] = "message_changed"
        payload["event"]["message"] = None
        self.assertEqual(self.signed_post(payload).status_code, 400)

    def test_split_responsibilities_originals_and_notifications_without_approval(self):
        self.signed_post()
        self.process()
        self.assertEqual(dict(Task.objects.values_list("type", "assignee_id")), {"AUTOMATION": self.don.pk, "FORM": self.anita.pk})
        self.assertEqual(SlackTaskMessage.objects.count(), 2)
        self.assertEqual(SlackIntakeEvent.objects.get().status, "routed")
        self.assertEqual(set(Notification.objects.values_list("user_id", flat=True)), {self.don.pk, self.anita.pk})
        self.assertFalse(Notification.objects.filter(user=self.admin).exists())
        self.assertFalse(Task.objects.exclude(build=None).exists())
        self.assertNotIn("<@UCLARE123>", Task.objects.first().description)
        self.process()
        self.assertEqual(Task.objects.count(), 2)
        self.assertEqual(Notification.objects.count(), 2)

    def test_multiple_categories_same_owner_only_one_notification(self):
        self.signed_post()
        self.process(self.analysis("AUTOMATION", "PIPELINE", "TAG"))
        self.assertEqual(Task.objects.count(), 3)
        self.assertEqual(Notification.objects.count(), 1)

    def test_followup_without_tag_updates_task_and_preserves_human_fields(self):
        self.signed_post()
        self.process(self.analysis("AUTOMATION"))
        task = Task.objects.get()
        task.title = "Human title"
        task.status = "IN_PROGRESS"
        task.assignee = self.anita
        task.description = "Human instructions"
        task.save()
        self.signed_post(self.payload(2, "What does the workflow do after signup?", "1787800000.000001"))
        self.process(self.analysis("AUTOMATION"))
        task.refresh_from_db()
        self.assertEqual((task.title, task.status, task.assignee_id, task.description), ("Human title", "IN_PROGRESS", self.anita.pk, "Human instructions"))
        self.assertEqual(Task.objects.count(), 1)
        self.assertEqual(task.slack_messages.count(), 2)
        self.assertEqual(Notification.objects.first().user_id, self.anita.pk)

    def test_completed_task_is_not_reopened(self):
        self.signed_post()
        self.process(self.analysis("FORM"))
        Task.objects.update(status="DONE")
        self.signed_post(self.payload(2, "Another form question", "1787800000.000001"))
        self.process(self.analysis("FORM"))
        self.assertEqual(Task.objects.filter(status="DONE").count(), 1)
        self.assertEqual(Task.objects.filter(status="TODO").count(), 1)

    def test_low_confidence_routes_to_channel_staff_not_clare(self):
        self.signed_post()
        self.process(self.analysis("OTHER", confidence=.3, uncertain=True))
        self.assertEqual(set(Task.objects.values_list("assignee_id", flat=True)), {self.don.pk, self.anita.pk})
        self.assertEqual(Task.objects.count(), 2)
        self.assertIn("triage", SlackIntakeEvent.objects.get().reason)
        self.assertFalse(Notification.objects.filter(user=self.admin).exists())

    def test_unmapped_category_forwards_original_to_assigned_channel_staff(self):
        self.signed_post()
        self.process(self.analysis("EMAIL"))
        self.assertEqual(SlackIntakeEvent.objects.get().status, "routed")
        self.assertEqual(Task.objects.count(), 2)

    def test_triage_reaches_both_channel_people_after_manual_reassignment(self):
        self.signed_post()
        self.process(self.analysis("AUTOMATION"))
        Task.objects.update(assignee=self.anita)
        Notification.objects.all().delete()
        self.signed_post(self.payload(2, "Which part is ready?", "1787800000.000001"))
        self.process(self.analysis(uncertain=True, confidence=.2))
        self.assertEqual(set(Notification.objects.values_list("user_id", flat=True)), {self.don.pk, self.anita.pk})

    def test_failed_ai_still_delivers_originals(self):
        self.signed_post()
        with patch("onboarding.slack_intake.analyze", side_effect=ValueError("secret provider failure")):
            slack_intake.process_channel(self.channel.pk)
        self.assertEqual(Task.objects.count(), 2)
        self.assertTrue(all("Unavailable" in message.interpretation for message in SlackTaskMessage.objects.all()))
        self.assertNotIn("secret provider", str(SlackIntakeEvent.objects.get().analysis))

    def test_missing_thread_root_is_explicit_staff_triage(self):
        self.signed_post(self.payload(thread="1787700000.000001"))
        self.process(self.analysis("AUTOMATION"))
        self.assertEqual(Task.objects.count(), 2)
        self.assertIn("original context", SlackIntakeEvent.objects.get().analysis["reason"])

    def test_no_action_does_not_notify(self):
        self.signed_post()
        self.process(self.analysis())
        self.assertEqual(SlackIntakeEvent.objects.get().status, "ignored")
        self.assertFalse(Notification.objects.exists())

    def test_missing_all_staff_blocks_only_setup_and_can_retry(self):
        SlackResponsibility.objects.all().delete()
        self.signed_post()
        self.process()
        event = SlackIntakeEvent.objects.get()
        self.assertEqual(event.status, "needs_setup")
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post(f"{self.root}events/{event.pk}/retry/").status_code, 200)
        event.refresh_from_db()
        self.assertEqual(event.status, "pending")

    def test_inactive_owner_not_notified(self):
        get_user_model().objects.filter(pk=self.don.pk).update(is_active=False)
        self.signed_post()
        self.process(self.analysis("AUTOMATION"))
        self.assertEqual(list(Task.objects.values_list("assignee_id", flat=True)), [self.anita.pk])

    def test_pause_during_analysis_stops_delivery(self):
        self.signed_post()
        def pause(_event):
            SlackIntakeSettings.objects.filter(pk=1).update(enabled=False)
            return self.analysis("FORM")
        with patch("onboarding.slack_intake.analyze", side_effect=pause):
            slack_intake.process_channel(self.channel.pk)
        self.assertFalse(Task.objects.exists())
        self.assertEqual(SlackIntakeEvent.objects.get().status, "pending")

    def test_active_lease_skips_duplicate_worker(self):
        from django.utils import timezone
        from datetime import timedelta
        self.signed_post()
        SlackChannel.objects.filter(pk=self.channel.pk).update(lease_token="other-worker", lease_until=timezone.now() + timedelta(minutes=5))
        with patch("onboarding.slack_intake.analyze") as ai:
            slack_intake.process_channel(self.channel.pk)
            ai.assert_not_called()

    def test_permissions_raw_source_only_available_through_assigned_task(self):
        self.signed_post()
        self.process(self.analysis("FORM"))
        task = Task.objects.get()
        self.client.force_authenticate(self.don)
        for endpoint in ["settings", "channels", "responsibilities", "events"]:
            self.assertEqual(self.client.get(f"{self.root}{endpoint}/").status_code, 403)
        self.assertEqual(self.client.get(f"/api/builds/tasks/{task.pk}/slack-context/").status_code, 404)
        self.assertEqual(self.client.get("/api/builds/tasks/").json()["count"], 0)
        self.client.force_authenticate(self.anita)
        response = self.client.get(f"/api/builds/tasks/{task.pk}/slack-context/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["results"][0]["original"], self.payload()["event"]["text"])
        self.assertTrue(self.client.get(f"/api/builds/tasks/{task.pk}/").json()["slack_intake"])

    def test_secret_write_only_config_validation_and_unique_responsibility(self):
        self.client.force_authenticate(self.admin)
        response = self.client.patch(self.root + "settings/", {"signing_secret": self.secret}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(self.secret, response.content.decode())
        self.assertEqual(self.client.patch(self.root + "settings/", {"workspace_id": "invalid"}, format="json").status_code, 400)
        self.assertEqual(self.client.post(self.root + "responsibilities/", {"channel": self.channel.pk, "category": "FORM", "assignee": self.don.pk}, format="json").status_code, 400)

    def test_ai_schema_rejects_nonfinite_invalid_and_duplicate_categories(self):
        for data in [self.analysis("AUTOMATION", "AUTOMATION"), self.analysis("FAKE"), self.analysis("FORM", confidence=float("nan"))]:
            serializer = slack_intake.AnalysisSerializer(data=data)
            self.assertFalse(serializer.is_valid())

    def test_ai_input_uses_only_same_thread_and_does_not_receive_staff_roster(self):
        self.signed_post()
        with patch("onboarding.slack_intake._chat", return_value=json.dumps(self.analysis("FORM"))) as ai:
            result = slack_intake.analyze(SlackIntakeEvent.objects.select_related("channel__client").get())
        content = ai.call_args.args[0][1]["content"]
        self.assertNotIn("don-test", content)
        self.assertEqual(result["items"][0]["category"], "FORM")

    def test_long_ai_context_is_bounded_but_original_is_preserved(self):
        original = "<@UCLARE123> " + "x" * 20000
        self.signed_post(self.payload(text=original))
        with patch("onboarding.slack_intake._chat", return_value=json.dumps(self.analysis("FORM"))) as ai:
            result = slack_intake.analyze(SlackIntakeEvent.objects.select_related("channel__client").get())
        content = json.loads(ai.call_args.args[0][1]["content"])
        self.assertEqual(len(content["current_message"]), 16000)
        self.assertEqual(ai.call_args.kwargs["timeout"], 30)
        self.assertTrue(result["uncertain"])
        self.assertEqual(SlackIntakeEvent.objects.get().text, original)

    def test_ai_deadline_disables_sdk_retries_for_slack_only(self):
        from builds import services as ai_services
        with patch.object(ai_services, "_active_provider", return_value="OPENAI"), patch.object(ai_services, "_model", return_value="test-model"), patch.object(ai_services, "_openai_complete", return_value=("{}", {})) as completion:
            ai_services._chat([], timeout=30, op="slack_intake")
        self.assertEqual(completion.call_args.kwargs, {"request_options": {"timeout": 30, "max_retries": 0}})

    def test_source_feed_is_paginated_and_task_list_does_not_hydrate_raw_history(self):
        self.signed_post()
        self.process(self.analysis("FORM"))
        task = Task.objects.get()
        for number in range(2, 25):
            event = SlackIntakeEvent.objects.create(channel=self.channel, event_id=f"EvPaged{number}", message_ts=f"1787800000.{number:06d}", thread_ts="1787800000.000001", sender_id="UCLIENT123", text="Private raw source", status="routed")
            SlackTaskMessage.objects.create(task=task, event=event, category="FORM", kind="question", interpretation="Context")
        self.client.force_authenticate(self.anita)
        with self.assertNumQueries(3):
            response = self.client.get(f"/api/builds/tasks/{task.pk}/slack-context/")
        self.assertEqual(len(response.json()["results"]), 20)
        self.assertEqual(response.json()["count"], 24)
        with self.assertNumQueries(2):
            tasks = self.client.get("/api/builds/tasks/")
        self.assertNotIn("Private raw source", tasks.content.decode())

    def test_raw_event_list_is_metadata_only(self):
        self.signed_post()
        self.client.force_authenticate(self.admin)
        with self.assertNumQueries(2):
            response = self.client.get(self.root + "events/?status=pending")
        self.assertNotIn("text", response.json()["results"][0])
        self.assertNotIn("analysis", response.json()["results"][0])

    def test_delivery_failure_rolls_back_tasks_and_can_retry(self):
        self.signed_post()
        with patch("onboarding.slack_intake.analyze", return_value=self.analysis("FORM")), patch("onboarding.slack_intake.Notification.objects.create", side_effect=RuntimeError("database unavailable")):
            with self.assertRaises(RuntimeError):
                slack_intake.process_channel(self.channel.pk)
        self.assertFalse(Task.objects.exists())
        self.assertFalse(SlackWorkItem.objects.exists())
        self.assertEqual(SlackIntakeEvent.objects.get().status, "pending")
        self.process(self.analysis("FORM"))
        self.assertEqual(Task.objects.count(), 1)


class FathomImportTests(TestCase):
    url = "/api/onboarding/webhooks/fathom/"
    root = "/api/onboarding/fathom/"
    secret = "whsec_" + base64.b64encode(b"fathom-local-test-signing-key-1234").decode()

    @classmethod
    def setUpTestData(cls):
        user = get_user_model()
        cls.admin = user.objects.create_user(username="fathom-admin", email="admin@fathom.example", role="admin")
        cls.staff = user.objects.create_user(username="fathom-staff", email="staff@fathom.example", role="employee")
        client = Clients.objects.create(name="Fathom demo client", email="client@example.test")
        cls.build = Build.objects.create(title="Client delivery", client=client, creator=cls.admin)
        cls.other_build = Build.objects.create(title="Other delivery", client=client, creator=cls.admin)
        FathomSettings.objects.create(pk=1, enabled=True, encrypted_webhook_secret=services.encrypt_secret(cls.secret)[0])

    def setUp(self):
        self.client = APIClient()
        self.payload = {
            "recording_id": 123456789,
            "title": "Client kickoff – résumé",
            "share_url": "https://fathom.video/share/local-test",
            "recording_start_time": "2026-08-27T10:00:00Z",
            "calendar_invitees": [{"email": "CONTACT@client.example"}],
            "default_summary": {"markdown_formatted": "Build a welcome workflow."},
            "transcript": [{"speaker": {"display_name": "Client"}, "text": "Please add a welcome email.", "timestamp": "00:01:02"}],
            "action_items": [{"description": "Draft the welcome email"}],
        }

    def signed_post(self, payload=None, *, body=None, timestamp=None, message_id="msg_local_1", signature=None):
        body = body if body is not None else json.dumps(payload if payload is not None else self.payload, ensure_ascii=False).encode()
        timestamp = str(timestamp if timestamp is not None else int(time.time()))
        digest = hmac.digest(base64.b64decode(self.secret[6:]), f"{message_id}.{timestamp}.".encode() + body, hashlib.sha256)
        return self.client.post(self.url, data=body, content_type="application/json",
            HTTP_WEBHOOK_ID=message_id, HTTP_WEBHOOK_TIMESTAMP=timestamp,
            HTTP_WEBHOOK_SIGNATURE=signature or "v1," + base64.b64encode(digest).decode())

    def route(self, build=None, email="contact@client.example"):
        return FathomRoutingRule.objects.create(participant_email=email, build=build or self.build)

    def test_signed_unmatched_meeting_is_saved_without_creating_tasks(self):
        self.assertEqual(self.signed_post().status_code, 200)
        meeting = FathomMeeting.objects.get()
        self.assertEqual(meeting.status, "pending")
        self.assertIn("Client: Please add", meeting.transcript)
        self.assertEqual(meeting.participant_emails, ["contact@client.example"])
        self.assertFalse(MeetingNote.objects.exists())
        self.assertFalse(Task.objects.exists())

    def test_exact_rule_attaches_notes_and_resends_are_idempotent(self):
        self.route()
        self.assertEqual(self.signed_post().status_code, 200)
        self.assertTrue(self.signed_post(message_id="different-redelivery-id").json()["duplicate"])
        self.assertEqual(FathomMeeting.objects.count(), 1)
        self.assertEqual(MeetingNote.objects.count(), 1)
        note = MeetingNote.objects.get()
        self.assertEqual(note.source, "fathom")
        self.assertEqual(note.build_id, self.build.pk)
        self.assertIn("Fathom summary (AI-generated)", note.raw_text)
        self.assertIn("Draft the welcome email", note.raw_text)
        self.assertEqual(str(note.meeting_date), "2026-08-27")
        self.assertEqual(Activity.objects.count(), 1)

    def test_conflicting_targets_stay_in_admin_inbox(self):
        self.route()
        self.route(self.other_build, "other@client.example")
        self.payload["calendar_invitees"].append({"email": "other@client.example"})
        self.assertEqual(self.signed_post().status_code, 200)
        self.assertIn("Multiple", FathomMeeting.objects.get().routing_reason)
        self.assertFalse(MeetingNote.objects.exists())

    def test_multiple_rules_for_same_build_are_not_ambiguous(self):
        self.route()
        self.route(email="other@client.example")
        self.payload["calendar_invitees"].append({"email": "other@client.example"})
        self.signed_post()
        self.assertEqual(MeetingNote.objects.get().build_id, self.build.pk)

    def test_disabled_rule_does_not_route(self):
        rule = self.route()
        rule.active = False
        rule.save()
        self.signed_post()
        self.assertEqual(FathomMeeting.objects.get().status, "pending")

    def test_missing_bad_expired_and_future_signatures_are_rejected(self):
        self.assertEqual(self.client.post(self.url, self.payload, format="json").status_code, 401)
        self.assertEqual(self.signed_post(signature="v1,invalid").status_code, 401)
        self.assertEqual(self.signed_post(timestamp=int(time.time()) - 301).status_code, 401)
        self.assertEqual(self.signed_post(timestamp=int(time.time()) + 400).status_code, 401)
        self.assertFalse(FathomMeeting.objects.exists())

    def test_body_tampering_is_rejected(self):
        raw = json.dumps(self.payload).encode()
        now = str(int(time.time()))
        sig = base64.b64encode(hmac.digest(base64.b64decode(self.secret[6:]), b"msg_local_1." + now.encode() + b"." + raw, hashlib.sha256)).decode()
        self.assertEqual(self.signed_post(body=raw + b" ", timestamp=now, signature="v1," + sig).status_code, 401)

    def test_multiple_signatures_accept_a_valid_v1(self):
        raw = json.dumps(self.payload).encode()
        now = str(int(time.time()))
        sig = base64.b64encode(hmac.digest(base64.b64decode(self.secret[6:]), b"msg_local_1." + now.encode() + b"." + raw, hashlib.sha256)).decode()
        self.assertEqual(self.signed_post(body=raw, timestamp=now, signature="v1,old v1," + sig).status_code, 200)

    def test_invalid_or_empty_payload_is_not_acknowledged(self):
        self.assertEqual(self.signed_post(body=b"not-json").status_code, 400)
        self.assertEqual(self.signed_post(payload={"recording_id": 1, "title": "Empty"}).status_code, 400)
        self.payload["share_url"] = "https://untrusted.example/recording"
        self.assertEqual(self.signed_post().status_code, 400)
        self.assertFalse(FathomMeeting.objects.exists())

    def test_disabled_import_and_oversize_body_fail_closed(self):
        from onboarding.fathom import MAX_WEBHOOK_BYTES
        self.assertEqual(self.signed_post(body=b"x" * (MAX_WEBHOOK_BYTES + 1)).status_code, 413)
        FathomSettings.objects.filter(pk=1).update(enabled=False)
        self.assertEqual(self.signed_post().status_code, 503)
        self.assertFalse(FathomMeeting.objects.exists())

    def test_failed_note_write_rolls_back_ingestion_for_safe_retry(self):
        self.route()
        with patch("onboarding.fathom.MeetingNote.objects.create", side_effect=RuntimeError("test storage failure")):
            with self.assertRaises(RuntimeError):
                self.signed_post()
        self.assertFalse(FathomMeeting.objects.exists())
        self.assertEqual(self.signed_post().status_code, 200)
        self.assertEqual(MeetingNote.objects.count(), 1)

    def test_staff_cannot_read_or_manage_inbox_and_secrets(self):
        self.signed_post()
        meeting = FathomMeeting.objects.get()
        self.client.force_authenticate(self.staff)
        for path in ["settings/", "rules/", "meetings/", f"meetings/{meeting.pk}/"]:
            self.assertEqual(self.client.get(self.root + path).status_code, 403)
        self.assertEqual(self.client.post(self.root + f"meetings/{meeting.pk}/attach/", {"build": self.build.pk}).status_code, 403)
        self.assertEqual(self.client.patch(self.root + "settings/", {"enabled": False}, format="json").status_code, 403)

    def test_manager_can_attach_once_but_not_move_handled_meetings(self):
        self.signed_post()
        meeting = FathomMeeting.objects.get()
        self.client.force_authenticate(self.admin)
        path = self.root + f"meetings/{meeting.pk}/attach/"
        for _ in range(2):
            self.assertEqual(self.client.post(path, {"build": self.build.pk}).status_code, 200)
        self.assertEqual(MeetingNote.objects.count(), 1)
        self.assertEqual(self.client.post(path, {"build": self.other_build.pk}).status_code, 400)
        self.assertEqual(self.client.post(self.root + f"meetings/{meeting.pk}/ignore/").status_code, 400)

    def test_ignored_recordings_do_not_reappear_on_redelivery(self):
        self.signed_post()
        meeting = FathomMeeting.objects.get()
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post(self.root + f"meetings/{meeting.pk}/ignore/").status_code, 200)
        self.route()
        self.signed_post()
        meeting.refresh_from_db()
        self.assertEqual(meeting.status, "ignored")
        self.assertFalse(MeetingNote.objects.exists())

    def test_settings_never_return_secret_and_require_it_before_enabling(self):
        FathomSettings.objects.all().delete()
        self.client.force_authenticate(self.admin)
        path = self.root + "settings/"
        self.assertEqual(self.client.patch(path, {"enabled": True}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(path, {"webhook_secret": "not-a-secret"}, format="json").status_code, 400)
        result = self.client.patch(path, {"webhook_secret": self.secret, "enabled": True}, format="json")
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.data["secret_configured"])
        self.assertNotIn(self.secret, json.dumps(result.data))
        self.assertNotEqual(FathomSettings.objects.get().encrypted_webhook_secret, self.secret)

    def test_rule_email_normalization_and_duplicate_validation(self):
        self.client.force_authenticate(self.admin)
        path = self.root + "rules/"
        self.assertEqual(self.client.post(path, {"participant_email": "CONTACT@client.example", "build": self.build.pk}).status_code, 201)
        self.assertEqual(FathomRoutingRule.objects.get().participant_email, "contact@client.example")
        self.assertEqual(self.client.post(path, {"participant_email": "Contact@client.example", "build": self.other_build.pk}).status_code, 400)

    def test_list_is_paginated_and_omits_full_meeting_bodies(self):
        FathomMeeting.objects.bulk_create([
            FathomMeeting(recording_id=str(i), webhook_id=f"msg{i}", title=f"Meeting {i}", transcript="private text") for i in range(25)
        ])
        self.client.force_authenticate(self.admin)
        with self.assertNumQueries(2):
            result = self.client.get(self.root + "meetings/")
        self.assertEqual(result.data["count"], 25)
        self.assertEqual(len(result.data["results"]), 20)
        self.assertNotIn("transcript", result.data["results"][0])
        self.assertNotIn("summary", result.data["results"][0])


class HelperTests(TestCase):
    def test_as_confidence_clamps_and_parses(self):
        self.assertEqual(_as_confidence(0.5), 0.5)
        self.assertEqual(_as_confidence("0.9"), 0.9)
        self.assertEqual(_as_confidence(5), 1.0)
        self.assertEqual(_as_confidence(-2), 0.0)
        self.assertIsNone(_as_confidence(None))
        self.assertIsNone(_as_confidence("not-a-number"))

    def test_service_account_detection(self):
        self.assertTrue(integrations._looks_like_service_account('{"private_key":"k","client_email":"a@b.iam"}'))
        self.assertFalse(integrations._looks_like_service_account("xoxb-slack-token"))
        self.assertFalse(integrations._looks_like_service_account(""))

    def test_oauth_state_roundtrip(self):
        signed = oauth.sign_state("SLACK", 7)
        self.assertEqual(oauth.unsign_state(signed), ("SLACK", "7"))

    def test_authorize_url_requires_config(self):
        # No client id/secret in the test env → must refuse rather than build a bad URL.
        with patch.dict("os.environ", {}, clear=False):
            import os
            os.environ.pop("ASANA_CLIENT_ID", None)
            with self.assertRaises(oauth.OAuthError):
                oauth.authorize_url("ASANA", "state", "https://x/callback")


class IntegrationClientTests(TestCase):
    @patch("onboarding.integrations.services.get_provider_secret", return_value="tok")
    @patch("onboarding.integrations.httpx.post")
    def test_slack_post_returns_ts(self, mock_post, _sec):
        mock_post.return_value = MagicMock(content=b"{}", json=lambda: {"ok": True, "ts": "123.45"})
        self.assertEqual(integrations.slack_post("C1", "hi"), "123.45")

    @patch("onboarding.integrations.services.get_provider_secret", return_value="tok")
    @patch("onboarding.integrations.httpx.post")
    def test_slack_post_raises_on_error(self, mock_post, _sec):
        mock_post.return_value = MagicMock(content=b"{}", json=lambda: {"ok": False, "error": "channel_not_found"})
        with self.assertRaises(integrations.IntegrationError):
            integrations.slack_post("C1", "hi")

    @patch("onboarding.integrations.services.get_provider_secret", return_value="tok")
    @patch("onboarding.integrations.httpx.post")
    def test_fireflies_transcript_parses(self, mock_post, _sec):
        mock_post.return_value = MagicMock(status_code=200, content=b"{}", json=lambda: {
            "data": {"transcript": {
                "title": "Kickoff", "date": 1700000000000, "transcript_url": "https://u",
                "sentences": [{"text": "hello", "speaker_name": "Jane"}],
                "meeting_attendees": [{"displayName": "Jane", "email": "Jane@Acme.com"}],
            }}
        })
        tr = integrations.fireflies_transcript("mid")
        self.assertEqual(tr["title"], "Kickoff")
        self.assertIn("Jane: hello", tr["text"])
        self.assertEqual(tr["participants"][0]["email"], "jane@acme.com")

    @patch("onboarding.integrations.services.get_provider_secret", return_value="tok")
    @patch("onboarding.integrations.httpx.post")
    def test_asana_create_task_returns_gid(self, mock_post, _sec):
        mock_post.return_value = MagicMock(status_code=201, content=b"{}", json=lambda: {"data": {"gid": "999"}})
        self.assertEqual(integrations.asana_create_task("proj", "Build A1"), "999")

    @patch("onboarding.integrations.services.get_provider_secret", return_value=None)
    def test_missing_connection_raises(self, _sec):
        with self.assertRaises(integrations.IntegrationError):
            integrations.slack_post("C1", "hi")


class AiOpTests(TestCase):
    _INSIGHT = ('{"summary":"s","needs":[],"pain_points":[],"services_mentioned":[],'
                '"action_items":[{"title":"t","detail":"d"}],"sentiment":"neutral","risks":[],'
                '"upsell_signals":[],"internal_summary":"i","external_summary":"e","confidence":0.8}')

    @patch("onboarding.services.ai._blueprint_model", return_value="gpt-4o")
    @patch("onboarding.services.ai._chat")
    def test_analyze_call_parses(self, mock_chat, _model):
        mock_chat.return_value = self._INSIGHT
        out = services.analyze_call("a transcript")
        self.assertEqual(out["confidence"], 0.8)
        self.assertEqual(out["external_summary"], "e")
        self.assertEqual(out["action_items"][0]["title"], "t")

    @patch("onboarding.services.ai._chat")
    def test_guardrail_blocks(self, mock_chat):
        mock_chat.return_value = '{"ok": false, "reason": "internal note leaked"}'
        verdict = services.guardrail_check("draft")
        self.assertFalse(verdict["ok"])
        self.assertIn("leaked", verdict["reason"])

    @patch("onboarding.services.ai._chat", return_value="")
    def test_guardrail_fails_closed_on_empty(self, _chat):
        self.assertFalse(services.guardrail_check("x")["ok"])


class ClientContextTests(TestCase):
    """Reuse routing fixtures; every external read and model response is isolated."""
    url, root, secret = SlackIntakeTests.url, SlackIntakeTests.root, SlackIntakeTests.secret
    payload, signed_post, analysis = SlackIntakeTests.payload, SlackIntakeTests.signed_post, SlackIntakeTests.analysis

    @classmethod
    def setUpTestData(cls):
        SlackIntakeTests.setUpTestData.__func__(cls)

    def setUp(self):
        from projects.models import GhlConnection
        from onboarding import investigations
        from projects.ghl_context import evidence
        from django.core.cache import cache
        cache.clear()
        self.work = investigations
        self.client = APIClient()
        SlackChannel.objects.filter(pk=self.channel.pk).update(context_enabled=True)
        self.channel.refresh_from_db()
        self.connection = GhlConnection.objects.create(client=self.channel.client, location_id="contextloc", encrypted_token=services.encrypt_secret("test-token")[0])
        self.evidence = [evidence("ghl:workflows", "ghl", {"area": "workflows", "records": [{"id": "flow123", "name": "Welcome", "status": "published"}], "returned": 1})]
        self.fetch = patch("onboarding.investigations.ghl_context.collect", return_value=self.evidence).start()
        self.addCleanup(patch.stopall)
        patch("onboarding.investigations._chat", autospec=True, side_effect=self.ai_reply).start()
        patch("onboarding.slack_intake.analyze", return_value=self.analysis("AUTOMATION", "FORM")).start()
        self.signed_post()
        slack_intake.process_channel(self.channel.pk)
        from onboarding.models import ClientInvestigation
        self.investigation = ClientInvestigation.objects.get()
        self.task = Task.objects.get(assignee=self.don)

    def ai_reply(self, messages, **kwargs):
        if kwargs["op"] == "client_reply_draft":
            return json.dumps({"reply": "Thanks for flagging the form issue. Which step is not working as expected?"})
        tasks = json.loads(messages[-1]["content"])["tasks"]
        return json.dumps({"briefs": [{"task_id": t["task_id"], "summary": "Review the setup.", "observations": [{"text": "Workflow observed, execution unverified.", "evidence": ["ghl:workflows"]}], "hypotheses": ["Form wiring may be incomplete."], "actions": ["Inspect form wiring."], "acceptance_checks": ["Use a synthetic submission in an approved test environment."], "questions": ["Which form?"]} for t in tasks]})

    def finish(self):
        self.assertTrue(self.work.process(self.investigation.pk))
        self.investigation.refresh_from_db()

    def test_split_routing_shares_one_investigation_without_external_writes(self):
        from onboarding.models import ClientInvestigation, StaffBrief
        self.assertEqual(ClientInvestigation.objects.count(), 1)
        self.assertEqual(StaffBrief.objects.count(), 2)
        self.fetch.assert_not_called()  # Original delivery does not wait for GHL.
        with patch("onboarding.integrations.slack_post") as send:
            self.finish()
            send.assert_not_called()
        self.assertFalse(self.work.process(self.investigation.pk))
        self.fetch.assert_called_once()
        self.assertEqual(Notification.objects.filter(user=self.don).count(), 2)
        self.assertEqual(Notification.objects.filter(user=self.anita).count(), 2)
        self.assertFalse(Notification.objects.filter(user=self.admin).exists())
        self.client.force_authenticate(self.don)
        result = self.client.get(f"/api/builds/tasks/{self.task.pk}/client-context/")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data["brief"]["observations"][0]["evidence"], ["ghl:workflows"])
        self.assertNotIn("test-token", json.dumps(result.data, default=str))

    def test_other_staff_cannot_read_evidence_even_on_a_public_build_task(self):
        build = Build.objects.create(client=self.channel.client, creator=self.admin, assignee=self.don, title="Visible build")
        task = Task.objects.create(build=build, assignee=self.don, title="Build work")
        self.client.force_authenticate(self.other)
        for route in ("client-context", "reply-draft", "ghl-acceptance"):
            response = self.client.get(f"/api/builds/tasks/{task.pk}/{route}/") if route != "reply-draft" else self.client.put(f"/api/builds/tasks/{task.pk}/{route}/", {}, format="json")
            self.assertEqual(response.status_code, 403)

    def test_same_client_sources_only_and_reply_prompt_never_receives_internal_notes(self):
        own = Build.objects.create(client=self.channel.client, creator=self.admin, title="Own build")
        other_client = Clients.objects.create(name="Different company")
        other = Build.objects.create(client=other_client, creator=self.admin, title="Foreign build")
        MeetingNote.objects.create(build=own, raw_text="PRIVATE_INTERNAL_DECISION")
        MeetingNote.objects.create(build=other, raw_text="FOREIGN_CLIENT_SECRET")
        captured = []
        def ai(messages, **kwargs):
            captured.append((kwargs["op"], messages))
            return self.ai_reply(messages, **kwargs)
        with patch("onboarding.investigations._chat", side_effect=ai):
            self.finish()
        text = json.dumps(captured)
        self.assertNotIn("FOREIGN_CLIENT_SECRET", text)
        draft_prompt = next(messages for op, messages in captured if op == "client_reply_draft")
        self.assertNotIn("PRIVATE_INTERNAL_DECISION", json.dumps(draft_prompt))

    def test_edited_draft_survives_followup_and_conflicting_save_is_rejected(self):
        self.finish()
        self.client.force_authenticate(self.don)
        root = f"/api/builds/tasks/{self.task.pk}"
        context = self.client.get(root + "/client-context/").data
        payload = {"revision": context["revision"], "version": context["draft"]["version"], "text": "My carefully edited reply.", "ready": True}
        self.assertEqual(self.client.put(root + "/reply-draft/", payload, format="json").status_code, 200)
        self.assertEqual(self.client.put(root + "/reply-draft/", payload, format="json").status_code, 409)
        self.signed_post(self.payload(2, text="The form still fails.", thread=self.payload()["event"]["ts"]))
        slack_intake.process_channel(self.channel.pk)
        self.finish()
        self.task.refresh_from_db()
        draft = self.client.get(root + "/client-context/").data["draft"]
        self.assertEqual(draft["text"], "My carefully edited reply.")
        self.assertTrue(draft["stale"])
        self.assertFalse(draft["ready"])

    def test_connection_rotation_fences_inflight_result(self):
        import uuid
        from projects.models import GhlConnection
        def rotate(*args, **kwargs):
            GhlConnection.objects.filter(pk=self.connection.pk).update(revision=uuid.uuid4())
            return self.evidence
        with patch("onboarding.investigations.ghl_context.collect", side_effect=rotate):
            self.assertFalse(self.work.process(self.investigation.pk))
        self.investigation.refresh_from_db()
        self.assertEqual(self.investigation.status, "stale")
        self.assertFalse(self.investigation.evidence.exists())

    def test_client_lease_prevents_duplicate_work(self):
        import uuid
        from datetime import timedelta
        from django.utils import timezone
        from onboarding.models import InvestigationPolicy
        InvestigationPolicy.objects.filter(client=self.channel.client).update(lease_token=uuid.uuid4(), lease_until=timezone.now() + timedelta(minutes=1))
        self.assertFalse(self.work.process(self.investigation.pk))
        self.fetch.assert_not_called()

    def test_ordinary_navigation_does_not_consume_context_refresh_limit(self):
        self.client.force_authenticate(self.don)
        for _ in range(8):
            self.assertEqual(self.client.get(f"/api/builds/tasks/{self.task.pk}/").status_code, 200)
        self.assertEqual(self.client.post(f"/api/builds/tasks/{self.task.pk}/client-context/", {}, format="json").status_code, 200)

    def test_model_invented_evidence_is_rejected(self):
        def hallucinate(messages, **kwargs):
            return self.ai_reply(messages, **kwargs).replace("ghl:workflows", "another-client:private")
        with patch("onboarding.investigations._chat", side_effect=hallucinate):
            self.finish()
        self.assertIn("AI briefing unavailable", self.investigation.reason)
        self.assertNotIn("another-client", json.dumps(list(self.investigation.briefs.values_list("content", flat=True))))

    def test_source_delete_purges_derived_drafts_even_when_intake_paused(self):
        self.finish()
        SlackIntakeSettings.objects.filter(pk=1).update(enabled=False)
        payload = self.payload()
        payload["event"] = {"type": "message", "subtype": "message_deleted", "channel": self.channel.channel_id, "deleted_ts": self.payload()["event"]["ts"], "event_ts": "1787800001.000001"}
        self.assertEqual(self.signed_post(payload).status_code, 200)
        self.assertEqual(SlackIntakeEvent.objects.get().text, "")
        self.assertFalse(self.investigation.evidence.exists())
        self.assertFalse(self.investigation.briefs.exclude(draft_text="").exists())

    def test_source_edit_reinterprets_without_duplicate_tasks(self):
        self.finish()
        payload = self.payload()
        payload["event"] = {"type": "message", "subtype": "message_changed", "channel": self.channel.channel_id, "message": {"ts": self.payload()["event"]["ts"], "text": "Corrected client request"}, "event_ts": "1787800001.000001"}
        self.assertEqual(self.signed_post(payload).status_code, 200)
        slack_intake.process_channel(self.channel.pk)
        self.assertEqual(Task.objects.count(), 2)
        self.assertEqual(SlackTaskMessage.objects.count(), 2)

    def test_uncaptured_history_delete_invalidates_remote_context(self):
        self.finish()
        payload = self.payload()
        payload["event"] = {"type": "message", "subtype": "message_deleted", "channel": self.channel.channel_id, "deleted_ts": "1787700000.000001", "event_ts": "1787800001.000001"}
        self.assertEqual(self.signed_post(payload).status_code, 200)
        self.assertFalse(self.investigation.evidence.exists())
        self.assertFalse(self.investigation.briefs.exclude(draft_text="").exists())

    def test_retention_clears_source_and_derived_content(self):
        from datetime import timedelta
        from django.utils import timezone
        self.finish()
        SlackIntakeEvent.objects.update(received_at=timezone.now() - timedelta(days=31))
        self.work.purge_expired()
        self.assertTrue(SlackIntakeEvent.objects.get().redacted)
        self.assertFalse(self.investigation.evidence.exists())

    def test_acceptance_checks_never_infer_absence_or_functional_correctness(self):
        from builds.ghl_acceptance import evaluate
        checks = [dict(area="workflows", record_id="flow123", field="status", expected="published"), dict(area="workflows", record_id="flow123", field="name", expected="Different"), dict(area="workflows", record_id="missing", field="exists", expected="")]
        self.assertEqual([r["status"] for r in evaluate(checks, self.evidence)], ["passed_check", "failed_check", "needs_evidence"])

    def test_oauth_is_user_bound_single_use_and_does_not_enable_intake(self):
        import os
        from urllib.parse import urlparse, parse_qs
        from onboarding.models import SlackContextGrant
        from onboarding.slack_context import SCOPES
        self.client.force_authenticate(self.admin)
        SlackIntakeSettings.objects.filter(pk=1).update(enabled=False)
        env = {"SLACK_APP_ID": "APPTEST", "SLACK_CLIENT_ID": "client-id", "SLACK_CLIENT_SECRET": "test-secret", "SLACK_CONTEXT_REDIRECT_URI": "https://example.test/callback"}
        with patch.dict(os.environ, env):
            result = self.client.post("/api/onboarding/slack/context/authorize/")
            self.assertEqual(result.status_code, 200)
            query = parse_qs(urlparse(result.data["url"]).query)
            self.assertIn("code_challenge", query)
            token = {"ok": True, "access_token": "xoxp-test", "token_type": "user", "team": {"id": "TTEST123"}, "authed_user": {"id": "UCLARE123", "scope": ",".join(SCOPES)}}
            with patch("onboarding.slack_context.token_request", return_value=token) as exchange:
                callback = "/api/onboarding/slack/context/callback/"
                self.assertEqual(self.client.get(callback, {"state": query["state"][0], "code": "test"}).status_code, 302)
                self.client.get(callback, {"state": query["state"][0], "code": "test"})
                exchange.assert_called_once()
        grant = SlackContextGrant.objects.get(pk=1)
        self.assertNotEqual(grant.encrypted_token, "xoxp-test")
        self.assertFalse(SlackIntakeSettings.objects.get(pk=1).enabled)


    def make_grant(self):
        from datetime import timedelta
        from django.utils import timezone
        from onboarding.models import SlackContextGrant
        return SlackContextGrant.objects.create(pk=1, workspace_id="TTEST123", slack_user_id="UCLARE123", connected_by=self.admin,
            encrypted_token=services.encrypt_secret("expired-token")[0], encrypted_refresh=services.encrypt_secret("refresh-token")[0],
            expires_at=timezone.now() - timedelta(seconds=1))

    def test_refresh_lease_serializes_token_rotation(self):
        from onboarding.slack_context import grant_token
        from onboarding.mcp import McpError
        grant = self.make_grant()
        def exchange(data):
            with self.assertRaises(McpError):
                grant_token(grant)
            return {"access_token": "new-token", "refresh_token": "rotated-refresh", "expires_in": 3600}
        with patch("onboarding.slack_context.token_request", side_effect=exchange) as remote:
            self.assertEqual(grant_token(grant), "new-token")
            remote.assert_called_once()
        grant.refresh_from_db()
        self.assertIsNone(grant.refresh_lease)
        self.assertEqual(services.decrypt_secret(grant.encrypted_refresh), "rotated-refresh")

    def test_revocation_during_refresh_cannot_restore_credentials(self):
        from onboarding.slack_context import grant_token, revoke
        from onboarding.mcp import McpError
        grant = self.make_grant()
        def exchange(data):
            revoke()
            return {"access_token": "must-not-be-saved", "expires_in": 3600}
        with patch("onboarding.slack_context.token_request", side_effect=exchange), self.assertRaises(McpError):
            grant_token(grant)
        grant.refresh_from_db()
        self.assertFalse(grant.active)
        self.assertEqual(grant.encrypted_token, "")

    def test_remote_thread_pagination_is_bounded_and_foreign_messages_are_filtered(self):
        from onboarding.slack_context import retrieve
        self.make_grant()
        thread = self.payload()["event"]["ts"]
        page = {"ok": True, "messages": [{"ts": thread, "thread_ts": thread, "text": "Own message"}, {"ts": thread, "team": "TFOREIGN", "text": "FOREIGN_SECRET"}], "response_metadata": {"next_cursor": "more"}}
        with patch("onboarding.slack_context.grant_token", return_value="token"), patch("onboarding.slack_context.read_thread_page", return_value=page) as read, patch("onboarding.slack_context.Client.discover", return_value={}):
            result = retrieve(self.investigation, time.monotonic() + 45)
        self.assertEqual(read.call_count, 2)
        self.assertNotIn("FOREIGN_SECRET", json.dumps(result, default=str))
        coverage = next(e for e in result if e["key"] == "slack:thread-coverage")
        self.assertEqual(coverage["completeness"], "partial")


class McpBoundaryTests(TestCase):
    def test_slack_thread_response_size_is_bounded(self):
        from onboarding.slack_context import read_thread_page
        from onboarding.mcp import McpError
        response = MagicMock(status_code=200)
        response.__enter__.return_value = response
        response.iter_content.return_value = [b" " * 512001]
        with patch("onboarding.slack_context.requests.get", return_value=response) as get, self.assertRaises(McpError):
            read_thread_page("token", {"channel": "CTEST"}, time.monotonic() + 8)
        self.assertFalse(get.call_args.kwargs["allow_redirects"])

    def test_unknown_write_tools_and_changed_schemas_fail_before_http(self):
        from onboarding.mcp import Client, McpError
        client = Client("ghl", "token", location="loc")
        allowed = {"opportunities_get-pipelines": {}}
        with patch.object(client, "rpc") as rpc:
            with self.assertRaises(McpError):
                client.read("execute_operation", {}, allowed=allowed, schemas={})
            with self.assertRaises(McpError):
                client.read("opportunities_get-pipelines", {}, allowed=allowed, schemas={"opportunities_get-pipelines": {"type": "object", "properties": {"locationId": {"type": "string"}}}})
            rpc.assert_not_called()

    def test_mcp_sse_response_is_bounded_and_redirects_are_not_followed(self):
        from onboarding.mcp import Client, McpError
        response = MagicMock(status_code=200, headers={"Content-Type": "text/event-stream"})
        response.__enter__.return_value = response
        def post(*args, **kwargs):
            self.assertFalse(kwargs["allow_redirects"])
            request_id = kwargs["json"]["id"]
            response.iter_content.return_value = [b"event: message\ndata: " + json.dumps({"jsonrpc": "2.0", "id": request_id, "result": {"tools": []}}).encode() + b"\n\n"]
            return response
        with patch("onboarding.mcp.requests.post", side_effect=post):
            self.assertEqual(Client("slack", "token").rpc("tools/list"), {"tools": []})
        response.status_code = 302
        with patch("onboarding.mcp.requests.post", return_value=response), self.assertRaises(McpError):
            Client("slack", "token").rpc("tools/list")

    def test_ghl_cross_location_response_never_leaves_adapter(self):
        from projects.ghl_context import normalized
        from projects.ghl import GhlError
        with self.assertRaises(GhlError):
            normalized({"pipelines": [{"id": "foreign", "name": "private", "locationId": "other"}]}, "pipelines", "own")

    def test_exact_record_requires_optin_and_strict_location_identity(self):
        from types import SimpleNamespace
        from projects.ghl_context import collect
        connection = SimpleNamespace(client_id=1, revision="rev", location_id="own")
        with patch("projects.ghl.connection_token", return_value="token"), patch("projects.ghl_context.Client.discover", return_value={}), patch("projects.ghl._get", return_value={"location": {"id": "own"}}) as get:
            result = collect(connection, [], record_reference="contact123", allow_records=False)
            self.assertEqual(get.call_count, 1)
            self.assertEqual(result[-1]["completeness"], "unavailable")
        responses = [{"location": {"id": "own"}}, {"contact": {"id": "contact123", "locationId": "foreign", "tags": ["private-tag"], "email": "private@example.test"}}]
        with patch("projects.ghl.connection_token", return_value="token"), patch("projects.ghl_context.Client.discover", return_value={}), patch("projects.ghl._get", side_effect=responses):
            result = collect(connection, [], record_reference="contact123", allow_records=True)
            self.assertNotIn("private", json.dumps(result, default=str))
            self.assertEqual(result[-1]["completeness"], "unavailable")
