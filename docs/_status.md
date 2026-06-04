# Calari Internal — Build Status (updated 2026-06-04)

**Built & verified (typecheck + lint + production build all pass):**
- Epic 0 Project setup — Next.js 16 + TS + Tailwind v4, scripts, env, eslint. ✅
- Epic 1 Database & Prisma — full schema (13 models), client singleton, seed script, docker-compose Postgres. ✅
- Epic 2 Auth & roles — Auth.js email+password, JWT sessions, role guards, route middleware, team management. ✅
- Epic 3 App shell — root layout, role-aware nav, notification bell, status badges. ✅
- Epic 4 Clients — list + create. ✅ (edit/archive: later)
- Epic 5 Builds & Brief — create, brief view (sources/stages/manual actions/goals), assign/reassign, status transitions (ready-for-review / approve / request-changes). ✅
- Epic 6 AI brief generation — OpenAI structured-output module, notes→draft action, review screen, regenerate, approve & assign. ✅ (PDF/file-notes parsing: later)
- Epic 7 Tasks — create, type, status, progress notes, member dashboard. ✅ (dedicated task detail route: later)
- Epic 9 Comments & activity — comment threads + activity log. ✅
- Epic 10 Notifications — notify() service (in-app + email via Resend), bell w/ unread count, notifications center. ✅ (polling/SSE + per-event templates polish: later)

**Remaining for MVP / next:**
- Epic 8 Documents / uploads (UploadThing) — NOT started.
- Epic 10 polish — real-time bell updates, richer email templates.
- Epic 11 Dashboards & reporting, Epic 12 AI extensions, Epic 13 Testing, Epic 14 Deployment, Epic 15 Polish.

**Run it:** see ../README.md (docker compose up → db:migrate → db:seed → dev). Seed admin: clare@calarisolutions.com / admin123.

**Note:** a corrupted `.git` folder from the sandbox should be deleted; run `git init` locally.

---

