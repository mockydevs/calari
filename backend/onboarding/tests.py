"""Tests for the onboarding-intelligence pipeline. External HTTP + AI calls are
mocked, so these run without real credentials or network."""
from unittest.mock import patch, MagicMock

from django.test import TestCase

from onboarding import integrations, services, oauth
from onboarding.tasks import _as_confidence


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
