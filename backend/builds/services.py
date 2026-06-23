"""
Builds — non-CRUD service logic. Implemented in Phase 2d (ports of the Next.js
lib/{ai,s3,document-text,api-keys}.ts). Until then these raise NotImplementedError
and the views surface a clean 501 so the API surface is complete and discoverable.
"""


class NotImplementedYet(NotImplementedError):
    """Raised by not-yet-ported service functions; mapped to HTTP 501 by views."""


def generate_brief_draft(notes_text: str, provider: str | None = None) -> dict:
    raise NotImplementedYet("AI brief generation is implemented in Phase 2d.")


def run_brief_qa(build) -> dict:
    raise NotImplementedYet("Brief QA check is implemented in Phase 2d.")


def generate_task_sop(task) -> str:
    raise NotImplementedYet("Task SOP generation is implemented in Phase 2d.")


def extract_text(file_bytes: bytes, filename: str) -> str:
    # Safe default until the pypdf/python-docx port lands in Phase 2d.
    return ""


def presign_upload(filename: str, content_type: str) -> dict:
    raise NotImplementedYet("S3 presigned uploads are implemented in Phase 2d.")


def encrypt_api_key(plaintext: str) -> tuple[str, str]:
    raise NotImplementedYet("AI key encryption is implemented in Phase 2d.")


def decrypt_api_key(encrypted: str) -> str:
    raise NotImplementedYet("AI key decryption is implemented in Phase 2d.")
