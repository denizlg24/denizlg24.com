# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=oven/bun:1.4 /usr/local/bin/bun /usr/local/bin/bun
COPY . .
RUN --mount=type=tmpfs,target=/app/node_modules,size=1073741824 \
    --mount=type=tmpfs,target=/tmp/stockwatcher-bun,size=536870912 \
    BUN_INSTALL_CACHE_DIR=/tmp/stockwatcher-bun bun install --frozen-lockfile && bun run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    STOCKWATCHER_DB_PATH=/app/data/stockwatcher.sqlite \
    ALERT_MONITOR=1
RUN mkdir -p /app/data /app/.next/cache && chown -R node:node /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=8s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "server.js"]
