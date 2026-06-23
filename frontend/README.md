# Calari Internal — Frontend

Internal client-delivery system for Calari Solutions. The boss uploads client meeting notes,
AI drafts the build (contact sources, pipeline stages, manual actions, tasks), then it's
reviewed and delegated to a team member who works the tasks, reports progress, and is tracked
with notifications.

Stack: Next.js 16 (App Router) · React 19 · Tailwind v4. **No database or auth lives here** —
the frontend consumes the Django REST API through a server-side **BFF proxy**
(`src/app/api/portal/*`) that holds the Django JWT in httpOnly cookies. All data, auth, AI brief
generation, email, and file storage are owned by the backend (`../backend`).

## Local setup

1. **Install deps**
   ```bash
   npm install
   ```
2. **Run the backend** — see `../backend` (or `docker compose up` from the repo root, which
   runs both halves together).
3. **Configure env** — copy `.env.example` to `.env` and fill values. The key one is
   `DJANGO_API_URL` (e.g. `http://localhost:8000`); the BFF uses it server-side.
4. **Run**
   ```bash
   npm run dev          # http://localhost:3000
   ```

## Scripts
- `npm run dev` / `build` / `start`
- `npm run typecheck` · `npm run lint`

## Flow
New build → paste meeting notes → **AI draft** → review/edit → **approve & assign** → member
works tasks & reports → notifications fire on assign/update.

## Deployment

Both halves deploy together from the repo-root `docker-compose.yml` (see the root `README.md`).
This `Dockerfile` builds the standalone Next.js image; `scripts/docker-start.sh` launches the
server (`node server.js`). Set `DJANGO_API_URL` to the public API URL in the platform dashboard.

### Health check
Coolify's health check → `GET /api/health`, used to gate readiness.
