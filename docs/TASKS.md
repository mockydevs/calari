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

# Calari Internal — Build Task List

Comprehensive, no-shortcuts backlog for the client delivery system.
Stack: Next.js (App Router) · Prisma · PostgreSQL · Auth.js · Tailwind + shadcn/ui · OpenAI · UploadThing · Resend · Vercel.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done. Work top-to-bottom; epics are roughly dependency-ordered.

---

## Epic 0 — Project setup & tooling

- [ ] Initialize Next.js app (App Router, TypeScript, ESLint) in this folder
- [ ] Set up `package.json` scripts (`dev`, `build`, `start`, `lint`, `typecheck`, `db:*`, `test`)
- [ ] Install & configure Tailwind CSS
- [ ] Install & init shadcn/ui; add base components (button, input, textarea, dialog, dropdown, table, card, badge, toast, tabs, select)
- [ ] Configure path aliases (`@/*`) in `tsconfig.json`
- [ ] Add Prettier + ESLint config and a format script
- [ ] Set up `.env.example` and `.env.local` (DATABASE_URL, AUTH_SECRET, OPENAI_API_KEY, RESEND_API_KEY, UPLOADTHING_*, APP_URL)
- [ ] Add `.gitignore` (node_modules, .env*, .next, etc.)
- [ ] `git init`, first commit
- [ ] Add `README.md` with local setup steps
- [ ] Set up Husky + lint-staged pre-commit hook (lint + typecheck)

## Epic 1 — Database & Prisma

- [ ] Provision a Postgres database (local Docker + hosted dev on Supabase/Neon)
- [ ] Install Prisma + `@prisma/client`; run `prisma init`
- [ ] Write `schema.prisma`: enums (Role, BuildStatus, TaskType, TaskStatus, ContactSourceType)
- [ ] Model: User
- [ ] Model: Client
- [ ] Model: Build (with brief fields)
- [ ] Model: ContactSource
- [ ] Model: PipelineStage
- [ ] Model: ManualAction
- [ ] Model: Task (incl. `aiGenerated`)
- [ ] Model: Document
- [ ] Model: MeetingNote (incl. `aiOutput` Json, `aiStatus`)
- [ ] Model: Comment
- [ ] Model: Notification
- [ ] Run first migration; verify schema in DB
- [ ] Create Prisma client singleton (`lib/db.ts`) to avoid hot-reload connection leaks
- [ ] Write a seed script (admin user "Clare", 1–2 members, a sample client/build)
- [ ] Add `db:migrate`, `db:seed`, `db:studio` scripts

## Epic 2 — Auth & roles

- [ ] Install & configure Auth.js (NextAuth)
- [ ] Choose + implement provider (magic-link email via Resend, or credentials) — confirm with Clare
- [ ] Prisma adapter for Auth.js (sessions/users tables)
- [ ] Extend session to include `role` and `userId`
- [ ] Login page `/login`
- [ ] Logout action
- [ ] Middleware: protect all routes except `/login`
- [ ] Role guard helper (`requireAdmin`, `requireUser`) for server actions & pages
- [ ] Seed/first-admin bootstrap flow
- [ ] Team management page `/settings/team` (admin: invite, set role, deactivate)

## Epic 3 — App shell & navigation

- [ ] Root layout with auth-aware header (logo, nav, notification bell, user menu)
- [ ] Role-aware sidebar/nav (admin vs member items)
- [ ] Toast/notification provider wired globally
- [ ] Loading & error boundaries; not-found page
- [ ] Responsive base styling pass
- [ ] Reusable data-table component + empty states

## Epic 4 — Clients module

- [ ] `/clients` list (admin) with search
- [ ] Create client (dialog/form) — server action + validation (zod)
- [ ] Edit client
- [ ] Client detail showing its builds
- [ ] Archive/delete client (with confirm)

## Epic 5 — Builds & Brief

- [ ] `/builds` list — admin sees all, member sees assigned; filters by status/assignee
- [ ] `/builds/new` — create build (title, client) + meeting-notes upload/paste entry point
- [ ] Build detail `/builds/[id]` — header (status, client, assignee, due date) + tabs
- [ ] Brief editor: Contact Sources (add/edit/remove, type + label)
- [ ] Brief editor: Pipeline Stages (ordered, reorderable, name/description/needsManual)
- [ ] Brief editor: Manual Actions (nested under a stage)
- [ ] Brief editor: Goals + Integrations fields
- [ ] Assign / reassign member (admin) — triggers notification
- [ ] Build status transitions (DRAFT → AI_DRAFTED → ASSIGNED → IN_PROGRESS → READY_FOR_REVIEW → CHANGES_REQUESTED → DELIVERED) with guards
- [ ] "Ready for review" action (member) + "Approve" / "Request changes" (admin)
- [ ] Zod validation + server actions for every mutation above

## Epic 6 — AI brief generation

- [ ] Install OpenAI SDK; server-only client wrapper (`lib/ai.ts`)
- [ ] Define the JSON schema for structured output (sources/stages/actions/tasks/goals)
- [ ] Write the extraction prompt (solutions-architect persona)
- [ ] Server action: take MeetingNote → call model with structured output → persist rows
- [ ] Set `aiGenerated=true` on AI-created tasks; store raw `aiOutput` on MeetingNote
- [ ] Handle file-notes input: PDF/doc → text parsing before the AI step
- [ ] AI status states on MeetingNote (pending/processing/done/failed) + UI feedback
- [ ] `/builds/[id]/review` screen — AI draft shown, fully editable, "Approve & assign"
- [ ] "Regenerate" action (re-run after editing notes)
- [ ] Error handling: model timeout, invalid JSON, empty notes; retry path
- [ ] Cost/usage logging per call
- [ ] Guardrails: cap input size, strip secrets, key server-side only

## Epic 7 — Tasks module

- [ ] Task list on build detail (grouped by status or type)
- [ ] Create task (title, type, description, assignee, due date)
- [ ] Edit task; change type/assignee/due date
- [ ] Update status (TODO/IN_PROGRESS/BLOCKED/DONE) — quick action
- [ ] Progress note field (member's latest report) — triggers notification
- [ ] Task detail `/builds/[id]/tasks/[taskId]`
- [ ] Member dashboard: "My tasks / my builds" view
- [ ] Delete task (with confirm)

## Epic 8 — Documents / file uploads

- [ ] Set up UploadThing (or S3 presigned) — server route + client uploader
- [ ] Upload scoped to a task
- [ ] Upload scoped to a whole build
- [ ] Document list with filename, uploader, date, download link
- [ ] File-type/size validation
- [ ] Delete document (with confirm + storage cleanup)
- [ ] Upload triggers notification to admin

## Epic 9 — Comments / activity

- [ ] Comment thread component (build- and task-scoped)
- [ ] Post comment (server action) — triggers notification to the other party
- [ ] Activity/audit log (status changes, assignments, uploads) on build detail

## Epic 10 — Notifications

- [ ] `notify(userId, type, message, link)` service: creates row + sends email
- [ ] Email templates (Resend): build assigned, task updated, doc uploaded, ready for review, changes requested, new comment
- [ ] Wire `notify` into every trigger point (epics 5–9)
- [ ] Notification bell: unread count + dropdown of recent
- [ ] `/notifications` center: list, mark read, mark all read, deep links
- [ ] Polling (30s) or SSE for near-real-time bell updates
- [ ] Per-user email on/off preference (optional, can defer)

## Epic 11 — Dashboards & reporting

- [ ] Admin dashboard: all active builds, status counts, what needs review
- [ ] Status board (kanban by build status)
- [ ] Basic metrics: builds delivered, avg time-to-deliver, open vs done tasks
- [ ] AI-task accept rate (AI-generated vs edited/removed)
- [ ] Stalled-build flag (no update in N days)

## Epic 12 — AI extensions (post-MVP, from the plan)

- [ ] Per-task build SOP generator (step-by-step GHL/Zapier instructions)
- [ ] Brief-vs-build QA check (flag gaps against the brief)
- [ ] Auto-documentation: rough notes → clean handover doc
- [ ] Weekly digest of build statuses (scheduled job + email)
- [ ] Semantic search over past builds (embeddings)

## Epic 13 — Testing & QA

- [ ] Set up test runner (Vitest) + React Testing Library
- [ ] Unit tests: validation schemas, status-transition guards, `notify` logic
- [ ] Unit test: AI output parser/mapper (mock the model response)
- [ ] Integration tests for key server actions (create build, assign, upload, comment)
- [ ] E2E (Playwright): login → create build → AI draft → assign → member updates → notified
- [ ] Seed-based manual QA script / checklist
- [ ] Type checking passes (`tsc --noEmit`) in CI
- [ ] Accessibility pass on core screens

## Epic 14 — Deployment & ops

- [ ] Production Postgres provisioned; connection pooling configured
- [ ] Environment variables set in Vercel (all secrets)
- [ ] Deploy to Vercel; verify build & migrations run
- [ ] Run migrations against prod; seed first admin
- [ ] Set up error monitoring (Sentry) and basic logging
- [ ] Backups for the database
- [ ] Domain / access restricted to the team
- [ ] Smoke test in production

## Epic 15 — Polish & handover

- [ ] Empty states, loading skeletons, error copy review
- [ ] Mobile/responsive pass
- [ ] Final README + short internal "how to use it" guide for the team
- [ ] Walkthrough/demo for Clare on a real onboarding

---

### Suggested MVP cut (ship first)
Epics 0–8 (through file uploads) + the assignment/update notifications from Epic 10 = a usable system Clare can pilot on the next client. Epics 11–12 and the rest layer on after.
