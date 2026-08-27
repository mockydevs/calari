# Task workspace overhaul

Work is on `codex/task-workspace-revamp`, based on `origin/main`. Nothing has been pushed or deployed.

## Workflows

- **Overview:** a compact dashboard for assignments and GHL builds. Existing project reporting is retained at `/dashboard?view=reports`.
- **Tasks:** admins and members granted `builds_manage` can create internal tasks without a client/build, or link a task to a client build. Set title, instructions, staff assignee, priority, and an optional due date. Search, status/category/work-type filters, My tasks, counts, and pagination share the same API filters.
- **GHL delivery:** create a client build, paste/upload meeting notes, and optionally start AI analysis. Review the meeting checklist, edit suggestions, and approve selected requests/changes into staff tasks. Each suggestion can have a different assignee. Questions, decisions, and informational notes remain in the meeting record.
- **Sections:** Automations, Pipelines, Tags & fields, Funnels, Forms & payments, and Email copy. Existing additional categories remain compatible with stored data.
- **Staff:** update assigned task status. Managers control creation, reassignment, editing, and deletion. Existing build owners can update their build tasks' status. Internal task reads are limited to managers, the creator, and the assignee; existing staff visibility of GHL builds remains unchanged.

An approved task has a unique link to its source meeting item. Publishing retries do not duplicate tasks. Assignment locks the item against AI re-sync; task status changes update the checklist. Edit assigned work in Tasks. New AI suggestions do not automatically create staff assignments.

## Local development (PowerShell, no Docker required)

Production continues to use the existing PostgreSQL/Redis settings. The opt-in `config.settings_local` uses an isolated SQLite database, memory cache/queue, and in-memory email delivery. It must never be used for production. Vector retrieval is disabled locally. Local task analysis runs eagerly; production uses the configured Celery worker.

From the repository root:

```powershell
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
./.venv/Scripts/python.exe -m pip install 'openai>=2,<3' 'anthropic>=0.40,<1' 'pgvector>=0.3,<1' 'pypdf>=5,<6'
cd backend
../.venv/Scripts/python.exe manage.py migrate --settings=config.settings_local
../.venv/Scripts/python.exe manage.py createsuperuser --settings=config.settings_local
../.venv/Scripts/python.exe manage.py runserver 127.0.0.1:8000 --settings=config.settings_local
```

In a second terminal, from `frontend`:

```powershell
$env:DJANGO_API_URL='http://127.0.0.1:8000'
npm ci
npm run dev -- --hostname 127.0.0.1
```

Open `http://127.0.0.1:3000`. The working checkout has a git-ignored root `.env` pointing the frontend at this local API, plus fictional demo records in `backend/local.sqlite3`. Those records are not part of a migration or production seed. Local emails do not leave the process.

## Deployment requirements

1. Back up the production database and apply migration `builds.0020` in staging first. It adds nullable task creator/source/build fields, priority, and additional choices without replacing existing tasks.
2. Deploy the backend and frontend together. The new UI expects the new task fields, summary, assignee roster, and publication endpoint.
3. Configure an AI provider in **Administration → AI configuration** and run the Celery worker. Production AI calls use the existing provider integration. This branch does not add a second AI service.
4. Confirm the real provider, PostgreSQL concurrent publication behavior, Redis worker, notification email, and storage upload flows in staging before rollout.

Migration `0014` now removes the VisionGap composite index before dropping its field so fresh SQLite installs can run. Already-applied migrations are unaffected. The manual email smoke script now runs only when invoked directly, not during test discovery. The Docker image also installs the PDF reader needed for PDF meeting-note uploads.

## Verification

See [the performance review](performance-review.md) for local timing results and read-only production findings. The current preview uses the optimized standalone build; `npm run dev` still intentionally compiles routes on demand.

```powershell
# From backend
../.venv/Scripts/python.exe manage.py test --settings=config.settings_local --noinput
../.venv/Scripts/python.exe manage.py makemigrations --check --dry-run --settings=config.settings_local
# From frontend
npm run typecheck
npm run lint
npm test
npm run build
```

Backend tests cover permissions, independent assignments, active-staff validation, filtered counts, six-section publishing, retry deduplication, transactional rollback, status syncing, locked-item preservation, extraction through a mocked AI provider, and provider failure handling. Browser verification uses fictional local data. No live AI provider or production database has been used to verify this branch.

## API additions

- `GET /api/builds/tasks/summary/`: filtered assignment counts.
- `GET /api/builds/tasks/assignees/`: active staff IDs and display names for task managers (no team-admin grant required).
- `POST /api/builds/tasks/`: `build` is optional; supports `priority` and `due_date`.
- `POST /api/builds/action-items/publish/`: `{ "build": 1, "items": [{ "id": 2, "assignee": 3, "priority": "HIGH", "due_date": null }] }`.
- `GET /api/builds/tasks/?kind=general` or `kind=ghl`: filter internal vs build-linked tasks.

This release organizes and assigns work about GHL. It does not automatically create automations, funnels, or other assets in a live GHL account.
