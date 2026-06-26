from django.test import SimpleTestCase

from builds import services


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
