# Code quality and build review — 27 August 2026

## Scope

Local changes on `codex/task-workspace-revamp`, alongside the task workspace and UI overhaul. Nothing was pushed, deployed, or changed in Coolify. This is a verified cleanup and reliability pass, not certification that the application cannot experience production performance problems.

## Removed

- Two unused frontend modules: the old top navigation and duplicate portal formatting helpers.
- Unused build actions, the obsolete implementation workspace renderer, the unused builder-document wrapper, utility functions, constants, and unused API types. Kept the section controls and client handover features that still have callers.
- Five obsolete validation schemas and twelve tests that exercised only those unused schemas. Active validation tests remain; eleven new transport regression cases replace the irrelevant coverage.
- The unused backend brief-draft generator and its prompt/schema. Database migrations and API endpoints were not deleted merely because the current UI does not call them.
- Six packages: `@hookform/resolvers`, `react-hook-form`, `class-variance-authority`, `date-fns`, `@vitejs/plugin-react`, and `vite-tsconfig-paths`. Vitest now uses a direct alias instead of an extra plugin.
- The stale Prisma external-package setting.

## Build and dependency safeguards

- Next.js and matching tooling updated from 16.2.9 to 16.3.3; patched transitive dependencies through normal compatible updates. The official [Windows-hosted RCE advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36) identifies 16.3.3 as patched. No claim of exploitation is made.
- Declared `@next/env` and `server-only` directly instead of depending on transitive availability.
- Added Knip, enabled TypeScript unused-local/parameter checks, and removed `ignoreBuildErrors`. Excluded generated standalone artifacts from source type checks.
- `npm run check` runs lint with zero warnings allowed, route-type generation and TypeScript, Knip, and Vitest. CI no longer ignores failed backend tests or lint. The dependency audit blocks high/critical advisories; Next's build cache is restored across compatible CI runs.
- CI installs the same PDF extra as Docker. Login smoke tests no longer print response bodies into CI logs.

## Performance and failure handling

- Project list counts now use correlated SQL aggregates instead of materializing every task and blocker. Independent subqueries avoid a task-by-blocker join expansion. A regression fixture verifies three queries, accurate counts, no hydrated task/blocker objects, empty-project behavior, and retained member visibility.
- The BFF streams upstream responses rather than buffering downloads into a second full in-memory body. It preserves bodyless 204/205/304 responses, fixing successful deletes being reported as errors.
- Shared Django transport deadlines are 30 seconds for GET/HEAD and 180 seconds for writes/AI requests. Caller cancellation is retained. Transport failures are not automatically retried because a mutation may have committed; the proxy returns 502/504 before response streaming starts. Once streaming starts, an upstream failure terminates the stream.
- Server API calls preserve all supported `Headers` representations. Discarded auth-challenge response bodies are cancelled before refresh.
- Backend startup now stops on failed primary/vector migrations. Vector migrations run only when configured. Worker, scheduler, and API process exits stop the container; the existing single-container topology is preserved. Optional library seeding remains off the readiness path.

## Verification

| Check | Result |
| --- | --- |
| Fresh `npm ci` | Passed; 404 installed packages |
| `npm run check` | Passed: zero lint warnings, type errors, or Knip findings; 25 tests |
| `npm audit --audit-level=high` | Zero reported vulnerabilities at review time |
| Production build, Next 16.3.3 | Passed, including TypeScript and all routes |
| Local build stages | Compile 6.0 s; TypeScript 6.9 s (not total deployment time or a cold-cache comparison) |
| Subsequent cached full build | 6.4 s locally; compile 653 ms and TypeScript 2.6 s |
| Django tests on isolated SQLite | 41 passed |
| Django system/migration drift checks | Passed; no migration changes detected |
| Startup shell regressions | Primary migration failure, vector migration failure, and worker exit passed |
| Browser smoke checks | Task list, project empty state, GHL build list/detail, and Implementation tab rendered successfully |

The fresh install prints an npm install-script policy notice for `unrs-resolver`; it did not prevent checks or the build. No package-script policy was loosened to hide it.

## Before production rollout

1. Run the committed CI workflow with PostgreSQL and build both Docker images. Docker integration and PostgreSQL execution were not available locally; SQLite does not validate PostgreSQL locking/concurrency behavior.
2. Validate the new startup supervisor in staging, including normal termination and broker outages. Longer term, separate worker/beat services for independent scaling and health checks.
3. Exercise real AI and larger upload paths against the 180-second deadline. A deadline bounds frontend waiting; it cannot undo backend work. Check current state before retrying a timed-out write.
4. Load-test representative project/task/client counts and concurrent sessions, recording p50/p95/p99 request time, query duration, and memory. The project-list response is still unpaginated; pagination requires a coordinated API/UI change if record counts grow substantially.
5. Backend extras are still installed with version ranges outside the hash-pinned base requirements. Consolidating that Python lock/export remains separate work; the npm audit result does not cover Python or container OS packages.

See [the performance review](performance-review.md) for earlier read-only production measurements and the intermittent Redis/Server Action findings.
