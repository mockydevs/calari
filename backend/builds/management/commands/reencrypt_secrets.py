"""Re-encrypt all stored provider secrets with the current primary encryption key.

Use during an encryption-key rotation:
  1. Set API_KEY_ENCRYPTION_SECRET to the NEW secret and
     API_KEY_ENCRYPTION_SECRET_FALLBACKS to the OLD secret(s).
  2. Run: python manage.py reencrypt_secrets
  3. Once it reports success, you can drop the fallbacks.

Decryption tries the new key then the fallbacks; re-encryption always uses the new
(primary) key — so existing AI keys + integration connections survive a rotation.
"""
from django.core.management.base import BaseCommand

from builds import services
from builds.models import AiApiKey


class Command(BaseCommand):
    help = "Re-encrypt stored secrets (AI keys + onboarding connections) with the current key."

    def handle(self, *args, **options):
        done = skipped = 0

        for k in AiApiKey.objects.all():
            try:
                plain = services.decrypt_api_key(k.encrypted_key)
            except Exception as e:  # noqa: BLE001
                self.stderr.write(self.style.WARNING(f"AiApiKey {k.id}: cannot decrypt ({e}); skipped"))
                skipped += 1
                continue
            k.encrypted_key, _ = services.encrypt_api_key(plain)
            k.save(update_fields=["encrypted_key"])
            done += 1

        try:
            from onboarding.models import Connection
        except Exception:  # noqa: BLE001 — onboarding optional
            Connection = None
        if Connection is not None:
            for c in Connection.objects.all():
                changed = False
                try:
                    c.encrypted_secret, _ = services.encrypt_api_key(services.decrypt_api_key(c.encrypted_secret))
                    changed = True
                except Exception as e:  # noqa: BLE001
                    self.stderr.write(self.style.WARNING(f"Connection {c.id} secret: {e}; skipped"))
                    skipped += 1
                if c.encrypted_refresh:
                    try:
                        c.encrypted_refresh = services.encrypt_api_key(services.decrypt_api_key(c.encrypted_refresh))[0]
                        changed = True
                    except Exception as e:  # noqa: BLE001
                        self.stderr.write(self.style.WARNING(f"Connection {c.id} refresh: {e}; skipped"))
                if changed:
                    c.save(update_fields=["encrypted_secret", "encrypted_refresh", "updated_at"])
                    done += 1

        self.stdout.write(self.style.SUCCESS(f"Re-encrypted {done} record(s); {skipped} skipped."))
