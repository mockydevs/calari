#!/usr/bin/env bash
set -euo pipefail

# A failed schema migration must stop startup, not leave a healthy-looking API
# serving against a partially migrated database.
python manage.py migrate --noinput
if [[ -n "${VECTOR_DATABASE_URL:-}" ]]; then
  python manage.py migrate vectorstore --database=vectors --noinput
fi

# Preserve the existing single-container topology; seed data is not a readiness
# dependency. Reap background processes on shutdown or any service failure.
cleanup() {
  trap - EXIT TERM INT
  local children
  children=$(jobs -pr)
  if [[ -n "$children" ]]; then
    kill $children 2>/dev/null || true
    wait || true
  fi
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

(python manage.py seed_build_library || echo "Build Library seed failed; retry manually." >&2) &
celery -A config worker --loglevel=info &
worker=$!
celery -A config beat --loglevel=info --scheduler django_celery_beat.schedulers:DatabaseScheduler &
beat=$!
daphne -b 0.0.0.0 -p 8000 config.asgi:application &
api=$!

# Even an unexpected clean exit of a required service should restart the unit.
wait -n "$worker" "$beat" "$api"
exit 1
