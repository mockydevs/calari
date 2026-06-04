#!/bin/sh
set -e

# Run pending Prisma migrations against the external database before serving traffic.
# If no migrations directory exists yet the step is skipped safely.
if [ -d prisma/migrations ]; then
  echo "==> Running database migrations..."
  node node_modules/.bin/prisma migrate deploy
  echo "==> Migrations complete."
else
  echo "==> No migrations directory found — skipping migrate deploy."
fi

echo "==> Starting Next.js server on port ${PORT:-3000}..."
exec node server.js
