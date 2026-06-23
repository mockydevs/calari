# Calari — Monorepo

One repository, two clean halves:

```
.
├── backend/    # Django REST API (the backend of record) — DRF + Channels + Celery on MySQL
└── frontend/   # Next.js app — Builds delivery system + Staff Portal, consumes the API via a BFF
```

The frontend never talks to the database directly for portal features: it calls the Django API
through a server-side **BFF proxy** (`frontend/src/app/api/portal/*`) that holds the Django JWT in
httpOnly cookies. (During the migration, the legacy "Builds" module still uses Prisma; this is
being moved into Django — see the migration plan.)

## Run it locally (Docker)

```bash
docker compose up --build
# backend  → http://localhost:8000  (Swagger at /swagger/)
# frontend → http://localhost:3000  (Staff Portal at /staff)
```

`docker compose` starts MySQL, Redis, the Django backend (migrates on boot, runs Daphne + Celery),
and the Next.js frontend.

## Run it locally (without Docker)

**Backend** (needs Python 3.13+, MySQL, Redis):
```bash
cd backend
cp .env.example .env.dev            # adjust DB/Redis as needed
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
daphne -b 0.0.0.0 -p 8000 config.asgi:application
# (separately, for emails/notifications) celery -A config worker -l info
```

**Frontend** (needs Node 22+):
```bash
cd frontend
npm install
# .env: set DJANGO_API_URL=http://localhost:8000
npm run dev                         # http://localhost:3000
```

## Deployment
Each half deploys independently on Coolify via its own compose:
`backend/Dockerfile.prod` and `frontend/docker-compose.yml`.
