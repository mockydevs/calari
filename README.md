# Calari Internal

Internal client-delivery system for Calari Solutions. The boss uploads client meeting notes,
AI drafts the build (contact sources, pipeline stages, manual actions, tasks), then it's
reviewed and delegated to a team member who works the tasks, reports progress, and is tracked
with notifications.

Stack: Next.js 16 (App Router) · Prisma · PostgreSQL · Auth.js (email+password) · Tailwind ·
OpenAI (brief generation) · Resend (emails).

## Local setup

1. **Install deps**
   ```bash
   npm install
   ```
2. **Start Postgres** (Docker — dev only)
   ```bash
   docker compose -f docker-compose.dev.yml up -d
   ```
3. **Configure env** — copy `.env.example` to `.env` and fill values.
   - `DATABASE_URL` is preset for the Docker DB.
   - `AUTH_SECRET`: run `npx auth secret` (or any long random string).
   - `OPENAI_API_KEY`: required for AI brief generation.
   - `RESEND_API_KEY`: optional; without it, notifications are in-app only.
4. **Migrate + seed**
   ```bash
   npm run db:migrate     # creates tables
   npm run db:seed        # demo admin, member, client, build
   ```
5. **Run**
   ```bash
   npm run dev
   ```

### Seed logins
- Admin (boss): `clare@calarisolutions.com` / `admin123`
- Member: `member@calarisolutions.com` / `member123`

## Scripts
- `npm run dev` / `build` / `start`
- `npm run typecheck` · `npm run lint`
- `npm run db:migrate` · `db:seed` · `db:studio` · `db:generate`

## Flow
New build → paste meeting notes → **AI draft** (`/builds/[id]/review`) → review/edit →
**approve & assign** → member works tasks & reports → notifications fire on assign/update.

See `docs/` for the full plan, task list, and pitch.

## Deployment — Coolify

The app ships as a Docker container. `docker-compose.yml` is the Coolify production file.
The database is managed externally — connect via `DATABASE_URL`.

### One-time Coolify setup

1. **New resource → Docker Compose** — connect this repo. Coolify picks up `docker-compose.yml` automatically.
2. **Set environment variables** in the Coolify service dashboard (these override the compose defaults):

   | Variable | Notes |
   |----------|-------|
   | `DATABASE_URL` | External Postgres connection string |
   | `AUTH_SECRET` | Run `npx auth secret` to generate |
   | `AUTH_TRUST_HOST` | `true` |
   | `AUTH_URL` / `NEXTAUTH_URL` | Public auth URL, e.g. `https://work.calari.tech` |
   | `APP_URL` / `NEXT_PUBLIC_APP_URL` | Public app URL, e.g. `https://work.calari.tech` |
   | `OPENAI_API_KEY` | AI brief generation |
   | `OPENAI_MODEL` | Defaults to `gpt-4o-mini` |
   | `RESEND_API_KEY` | Email notifications |
   | `EMAIL_FROM` | Sender address |
   | `AWS_REGION` | S3 region (e.g. `eu-central-1`) |
   | `AWS_S3_BUCKET_NAME` | S3 bucket name |
   | `AWS_ACCESS_KEY_ID` | AWS access key |
   | `AWS_SECRET_ACCESS_KEY` | AWS secret key |
   | `AWS_S3_ENDPOINT` | Optional — custom S3-compatible endpoint |

3. **Deploy** — Coolify builds from the Dockerfile and starts the container.

> **Migrations** run automatically at container startup via `scripts/docker-start.sh` —
> `prisma migrate deploy` is called before `node server.js`. No pre-deploy command needed.

### Health check

Coolify's health check → `GET /api/health`.
Returns `200 {"status":"ok","db":"ok"}` when healthy, or `200` with a degraded DB state
so the proxy keeps serving the app while the database recovers.
