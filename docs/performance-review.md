# Performance review — 27 August 2026

## Scope

Local measurements use fictional SQLite data and a production Next.js build. Live checks used the authenticated Coolify browser and read-only commands in the backend container. No production settings, records, services, or deployments were changed. Local fixes remain on `codex/task-workspace-revamp` with the workspace overhaul.

## Findings

- Local development compilation accounted for 792 ms of an 861 ms first visit to Clients; application code took 66 ms. Other first visits also paid compilation costs. The preview now serves the standalone production build on port 3000.
- Live frontend-to-backend routing is already internal (`http://backend:8000`). Live `DEBUG` and eager Celery execution are both false.
- The live PostgreSQL connection opened in 34.73 ms. Five `SELECT 1` calls took 0.53–1.68 ms. The connection-state snapshot contained one active session (the diagnostic query) and one idle session. This is a point-in-time check, not proof that intermittent stalls never occur.
- Live Redis pings took 19.44 ms initially, then 0.69 and 0.99 ms. Backend logs show a broker connection closed by the server at `2026-08-27 12:57:43`, followed by reconnection. The log timestamp is recorded as emitted. Correlate future disconnects with slow writes and delayed jobs before changing Redis settings.
- Bounded live serializer reads took 63.5 ms for two clients, 48.1 ms for an empty task page, and 146.3 ms for the newest build detail (11 queries, 106.9 ms SQL time). These measurements exclude HTTP/auth/rendering and do not expose record contents.
- Live frontend logs contain missing Server Action errors, including long action IDs and malformed `x`/`y` IDs. Stale clients after deployments are one possible cause; malformed requests are another. These logs alone cannot attribute failures to a user's clicks.
- Coolify does not expose container metrics for this Compose application. Resource-limit fields display zero limits; actual resource pressure cannot be concluded from those settings. The container reported 8 CPUs and load averages 4.12/2.69/2.26 at the check.

## Local fixes

- Added a shared loading boundary and pending sidebar indicators, preserving an interactive navigation shell while page data loads.
- Removed unused document/comment prefetches from task lists: 4 queries became 2, with detail responses unchanged.
- Added bounded task `page_size` support (default/max 100); the dashboard requests only its six visible assignments.
- Added a user-scoped unread notification summary (count + latest message), replacing a full page of notification bodies for the sidebar. Coalesced overlapping polls and removed the duplicate mount fetch. No shared user-data cache was added.
- Fetch the GHL staff roster alongside build/notes instead of in a second request wave.

## Verification

39 Django tests and 26 frontend tests pass. Lint, TypeScript, production build, and whitespace checks pass. Regression coverage verifies constant task-list query count, retained detail comments, bounded pagination, notification privacy and counts beyond one page, and anonymous denial. Browser navigation displays pending feedback and completes successfully.

Authenticated local full HTTP response times, three requests per page:

| Page | Samples (ms) | Median (ms) |
| --- | --- | --- |
| Clients | 41.1, 16.9, 17.3 | 17.3 |
| Tasks | 68.6, 36.8, 37.4 | 37.4 |
| Dashboard | 29.0, 27.3, 27.9 | 27.9 |
| GHL build detail | 95.7, 40.7, 41.4 | 41.4 |

These are local demo measurements, not production guarantees or a controlled before/after benchmark. The initial dev visit included compilation; repeated production requests do not.

## Next production checks

1. Deploy backend and frontend together in staging, then validate notification summaries and the task workflow. Production deployment still requires approval.
2. Reproduce a slow live click with request timing and correlate its timestamp with backend/Redis logs. Do not change database indexes or connection limits without a measured query/connection problem.
3. For stale-browser failures, refresh the page and confirm the deployed artifact is consistent across replicas. Evaluate per-release deployment IDs before rollout; do not silently retry mutations that may have succeeded.

References: [Next.js navigation/loading](https://nextjs.org/docs/app/getting-started/linking-and-navigating), [Server Action errors](https://nextjs.org/docs/messages/failed-to-find-server-action), [deployment version identification](https://nextjs.org/docs/app/api-reference/config/next-config-js/deploymentId).
