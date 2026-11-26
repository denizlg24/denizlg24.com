# node:sqlite backs preview workspaces, so `next build` (which collects page
# data) runs under node, with bun only as the installer.
FROM node:24-alpine AS dependencies
WORKDIR /workspace
COPY --from=oven/bun:1.4.4-alpine /usr/local/bin/bun /usr/local/bin/bun

COPY --parents package.json bun.lock apps/*/package.json packages/*/package.json ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY apps/stockwatcher apps/stockwatcher
RUN bun run --cwd apps/stockwatcher build

FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    STOCKWATCHER_DB_PATH=/app/data/stockwatcher.sqlite \
    ALERT_MONITOR=1

RUN mkdir -p /app/data /app/apps/stockwatcher/.next/cache && chown -R node:node /app
COPY --from=build --chown=node:node /workspace/apps/stockwatcher/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/stockwatcher/.next/static ./apps/stockwatcher/.next/static
COPY --from=build --chown=node:node /workspace/apps/stockwatcher/public ./apps/stockwatcher/public

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=8s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "apps/stockwatcher/server.js"]
