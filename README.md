# Calari — Monorepo

See [Task workspace overhaul](docs/task-workspace.md) for the new task/GHL workflows, local preview setup, verification, and rollout notes.
See [Code quality and build review](docs/code-quality-review.md) for cleanup, checks, performance safeguards, and remaining production validation.
See [Fathom meeting imports](docs/fathom-integration.md) for webhook setup, automatic routing, the meeting inbox, and activation requirements.
See [GHL Chat](docs/ghl-chat.md) for private account conversations, confirmed API actions, CSV/PDF exports, and execution limits.

One repository, two clean halves:

```
.
├── backend/    # Django REST API (the backend of record) — DRF + Channels + Celery on PostgreSQL
└── frontend/   # Next.js app — Builds delivery system + Staff Portal, consumes the API via a BFF
```

The frontend never talks to a database directly: every feature calls the Django API through a
server-side **BFF proxy** (`frontend/src/app/api/portal/*`) that holds the Django JWT in httpOnly
cookies. There is one auth (Django JWT) and one backend of record — no Prisma, no NextAuth.

## Run the Docker stack

```bash
docker compose up --build
# Ports are internal to Docker; use Coolify's proxy or a local port override.
```

A single root `docker-compose.yml` builds and runs both services: the Django backend (migrates on
boot, runs Daphne + Celery) and the Next.js frontend. PostgreSQL and Redis are external/managed —
point at them via env (`DATABASE_URL` / `REDIS_URL`).

## Run it locally (without Docker)

Both apps read a **single repo-root `.env`** (the backend loads it in `config/settings.py`;
the frontend loads it via `@next/env` in `next.config.ts`). Create it once at the repo root:
```bash
cp .env.example .env                # fill in DB/Redis/secrets
```

**Backend** (needs Python 3.13+, plus an external PostgreSQL + Redis):
```bash
cd backend
pip install -r requirements.txt
pip install "openai>=2,<3" "anthropic>=0.40,<1.0" "pgvector>=0.3,<1.0" "sentry-sdk>=2,<3" "pypdf>=5,<6"
python manage.py migrate
python manage.py createsuperuser
daphne -b 0.0.0.0 -p 8000 config.asgi:application
# (separately, for emails/notifications) celery -A config worker -l info
```

**Frontend** (needs Node 22+):
```bash
cd frontend
npm ci
npm run dev                         # http://localhost:3000
```

## Checks

See [GoHighLevel client connections](docs/ghl-integration.md) for token/location onboarding, read-access checks, staff completion reviews and migration requirements.

See [Slack delivery routing](docs/slack-delivery-routing.md) for private channel/responsibility assignments, original-message delivery, activation requirements, and client portal retirement.

Run `npm run check` and `npm run build` from `frontend/`. The check command enforces lint without warnings, TypeScript, unused-code detection, and tests. Production builds also validate types. Run `npm audit --audit-level=high` for dependency advisories.

From `backend/`, run `python manage.py check`, `python manage.py makemigrations --check --dry-run`, and `python manage.py test Auth builds onboarding projects a2p`. For isolated local SQLite verification, append `--settings=config.settings_local`; CI uses PostgreSQL. Run `bash scripts/test-start.sh` to test startup failure handling without contacting any services.

## Deployment
One stack, one file. Deploy the root `docker-compose.yml` on Coolify (New resource → Docker
Compose → connect this repo). It builds both services from `backend/Dockerfile` and
`frontend/Dockerfile`; set all secrets/connection vars in the Coolify dashboard.
