FROM node:22-bookworm-slim AS deps

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  HOSTNAME=0.0.0.0 \
  PORT=3000 \
  JEFF_DEPLOYMENT_MODE=cloud \
  JEFF_DISABLE_IN_APP_UPDATES=true \
  JEFF_ENABLE_RETURN_WORKFLOW=false \
  JEFF_ORDER_DB_PATH=/app/data/orders.db \
  JEFF_BACKUP_DIR=/app/data/backups

RUN groupadd --system jeff \
  && useradd --system --gid jeff --home-dir /app jeff \
  && mkdir -p /app/data /app/scripts \
  && chown -R jeff:jeff /app

COPY --from=builder --chown=jeff:jeff /app/public ./public
COPY --from=builder --chown=jeff:jeff /app/.next/standalone ./
COPY --from=builder --chown=jeff:jeff /app/.next/static ./.next/static
COPY --from=builder --chown=jeff:jeff /app/scripts/backup-sqlite.cjs ./scripts/backup-sqlite.cjs

USER jeff
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
