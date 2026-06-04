# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────
# Stage 1 — install all dependencies
# ─────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ─────────────────────────────────────────────
# Stage 2 — build the Next.js app
# ─────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# Generate Prisma client (uses the Alpine engine baked into node_modules)
RUN npx prisma generate

# Produce the standalone output (output: "standalone" in next.config.ts)
RUN npm run build

# ─────────────────────────────────────────────
# Stage 3 — lean production image
# ─────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user for security
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# ── Next.js standalone build ──────────────────
COPY --from=builder /app/public                         ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone  ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static      ./.next/static

# ── Prisma schema + migrations ────────────────
# Required by `prisma migrate deploy` at startup
COPY --from=builder --chown=nextjs:nodejs /app/prisma  ./prisma

# ── Prisma CLI + migration engine ─────────────
# `prisma migrate deploy` needs the CLI entry-point and the migration engine
# binary. Both come from the Alpine-targeted build in the builder stage so
# the platform matches the runner.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.bin/prisma          ./node_modules/.bin/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma               ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma/engines      ./node_modules/@prisma/engines

# ── Startup script ────────────────────────────
COPY --chown=nextjs:nodejs scripts/docker-start.sh ./docker-start.sh
RUN chmod +x ./docker-start.sh

# ── Health check ──────────────────────────────
# Coolify & orchestrators use this to decide when the container is ready.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget -qO- http://localhost:3000/api/health || exit 1

USER nextjs
EXPOSE 3000

# Runs migrations then starts the server
CMD ["./docker-start.sh"]
