# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────
# Stage 1 — install all dependencies
# ─────────────────────────────────────────────
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat openssl ca-certificates
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ─────────────────────────────────────────────
# Stage 2 — build the Next.js app
# ─────────────────────────────────────────────
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat openssl ca-certificates
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# Produce the standalone output (output: "standalone" in next.config.ts)
RUN npm run build

# ─────────────────────────────────────────────
# Stage 3 — lean production image
# ─────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user for security
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

RUN apk add --no-cache openssl ca-certificates curl tini

# ── Next.js standalone build ──────────────────
COPY --from=builder /app/public                         ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone  ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static      ./.next/static

# ── Startup script ────────────────────────────
COPY --chown=nextjs:nodejs scripts/docker-start.sh ./docker-start.sh
RUN chmod +x ./docker-start.sh

# ── Health check ──────────────────────────────
# Coolify & orchestrators use this to decide when the container is ready.
HEALTHCHECK --interval=30s --timeout=15s --start-period=120s --retries=5 \
    CMD curl -f http://localhost:3000/api/health || exit 1

USER nextjs
EXPOSE 3000

ENTRYPOINT ["tini", "--"]

# Runs migrations then starts the server
CMD ["./docker-start.sh"]
