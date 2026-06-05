#!/bin/sh
set -e

export PRISMA_HIDE_UPDATE_MESSAGE=1
PRISMA="node node_modules/prisma/build/index.js"

if [ -d prisma/migrations ]; then
  echo "==> Running database migrations..."
  if ! $PRISMA migrate deploy; then
    echo "==> Migration deploy failed. Attempting existing-schema recovery..."
    $PRISMA migrate resolve --applied 20260606000000_init 2>/dev/null || true
    $PRISMA db push --accept-data-loss --skip-generate
  fi
  echo "==> Migrations complete."
else
  echo "==> No migrations directory found - skipping migrate deploy."
fi

echo "==> Generating Prisma client..."
$PRISMA generate

echo "==> Starting Next.js server on port ${PORT:-3000}..."
exec node server.js
