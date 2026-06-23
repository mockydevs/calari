#!/bin/sh
set -e

echo "==> Starting Next.js server on port ${PORT:-3000}..."
exec node server.js
