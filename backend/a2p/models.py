"""A2P / 10DLC SMS-compliance client intake. A public form (on the marketing site)
submits these; the staff portal reviews them. Ported from the Kaizen A2P app but
reusing Calari's auth/email infrastructure."""
from django.db import models


class A2PStatus(models.TextChoices):
    NEW = "NEW", "New"
    IN_REVIEW = "IN_REVIEW", "In review"
    SUBMITTED = "SUBMITTED", "Submitted to registry"
    APPROVED = "APPROVED", "Approved"
    REJECTED = "REJECTED", "Rejected"


class A2PSubmission(models.Model):
    # ── Section 1 — Business details (must match EIN/Tax ID docs) ──
    legal_business_name = models.CharField(max_length=300)
    dba_brand_name = models.CharField(max_length=300, blank=True, default="")
    ein_tax_id = models.CharField(max_length=64)
    business_type = models.CharField(max_length=120)
    business_industry = models.CharField(max_length=120)
    business_website = models.CharField(max_length=500)
    business_address = models.CharField(max_length=500)
    city = models.CharField(max_length=120)
    state = models.CharField(max_length=120)
    zip_code = models.CharField(max_length=32)

    # ── Section 2 — Business contact ──
    business_email = models.EmailField()
    business_phone = models.CharField(max_length=64)

    # ── Section 3 — Authorized representative ──
    rep_first_name = models.CharField(max_length=120)
    rep_last_name = models.CharField(max_length=120)
    rep_email = models.EmailField()
    rep_phone = models.CharField(max_length=64)
    rep_job_title = models.CharField(max_length=120)

    # ── Section 4 — Brand & use case ──
    sms_use_case = models.CharField(max_length=200)
    message_types = models.JSONField(default=list)            # list[str]
    sms_program_description = models.TextField()

    # ── Section 5 — Opt-in & compliance ──
    optin_method = models.CharField(max_length=120)
    optin_form_url = models.CharField(max_length=500, blank=True, default="")
    has_sms_consent_checkbox = models.CharField(max_length=16)   # yes|no|unsure
    has_privacy_policy = models.CharField(max_length=16)         # yes|no
    privacy_policy_url = models.CharField(max_length=500, blank=True, default="")
    has_terms_of_service = models.CharField(max_length=16)       # yes|no
    terms_of_service_url = models.CharField(max_length=500, blank=True, default="")

    # ── Section 6 — Phone numbers (list of {number, label}) ──
    phone_numbers = models.JSONField(default=list)

    # ── Section 7 — Notes ──
    additional_notes = models.TextField(blank=True, default="")

    # ── Staff workflow ──
    status = models.CharField(max_length=16, choices=A2PStatus.choices, default=A2PStatus.NEW)
    review_notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["status", "created_at"])]

    def __str__(self):
        return f"A2P: {self.legal_business_name}"
