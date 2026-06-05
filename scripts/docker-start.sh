#!/bin/sh
set -e

# Run pending Prisma migrations against the external database before serving traffic.
if [ -d prisma/migrations ]; then
  echo "==> Baselining initial migration (safe no-op if already applied)..."
  node node_modules/.bin/prisma migrate resolve --applied 20260606000000_init 2>/dev/null || true
  echo "==> Running database migrations..."
  node node_modules/.bin/prisma migrate deploy
  echo "==> Migrations complete."
else
  echo "==> No migrations directory found — skipping migrate deploy."
fi

echo "==> Starting Next.js server on port ${PORT:-3000}..."
exec node server.js
