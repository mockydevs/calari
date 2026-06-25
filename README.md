# Calari — Monorepo

One repository, two clean halves:

```
.
├── backend/    # Django REST API (the backend of record) — DRF + Channels + Celery on PostgreSQL
└── frontend/   # Next.js app — Builds delivery system + Staff Portal, consumes the API via a BFF
```

The frontend never talks to a database directly: every feature calls the Django API through a
server-side **BFF proxy** (`frontend/src/app/api/portal/*`) that holds the Django JWT in httpOnly
cookies. There is one auth (Django JWT) and one backend of record — no Prisma, no NextAuth.

## Run it locally (Docker)

```bash
docker compose up --build
# backend  → http://localhost:8000  (Swagger at /swagger/)
# frontend → http://localhost:3000  (Staff Portal at /staff)
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
python manage.py migrate
python manage.py createsuperuser
daphne -b 0.0.0.0 -p 8000 config.asgi:application
# (separately, for emails/notifications) celery -A config worker -l info
```

**Frontend** (needs Node 22+):
```bash
cd frontend
npm install
npm run dev                         # http://localhost:3000
```

## Deployment
One stack, one file. Deploy the root `docker-compose.yml` on Coolify (New resource → Docker
Compose → connect this repo). It builds both services from `backend/Dockerfile` and
`frontend/Dockerfile`; set all secrets/connection vars in the Coolify dashboard.
