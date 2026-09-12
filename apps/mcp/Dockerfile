FROM oven/bun:1.4.0-alpine AS dependencies
WORKDIR /workspace

COPY --parents package.json bun.lock apps/*/package.json packages/*/package.json ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
COPY apps apps
COPY packages packages
RUN bun run --cwd apps/mcp build

FROM oven/bun:1.4.0-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3009

COPY --from=build --chown=bun:bun /workspace/apps/mcp/dist ./dist

USER bun
EXPOSE 3009
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:3009/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["bun", "run", "dist/index.js"]
