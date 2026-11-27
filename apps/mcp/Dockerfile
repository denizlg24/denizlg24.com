FROM oven/bun:1.4.4-alpine AS prune
WORKDIR /workspace
RUN bun add --global turbo@2.11.9
COPY . .
RUN turbo prune mcp --docker

FROM oven/bun:1.4.4-alpine AS dependencies
WORKDIR /workspace
COPY --from=prune /workspace/out/json/ ./
RUN --mount=type=cache,id=forge-bun-install,target=/root/.bun/install/cache,sharing=locked \
  bun install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
COPY --from=prune /workspace/out/full/ ./
RUN bun run --cwd apps/mcp build

FROM oven/bun:1.4.4-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3009

COPY --from=build --chown=bun:bun /workspace/apps/mcp/dist ./dist
COPY --from=build --chown=bun:bun /workspace/apps/mcp/public/favicon.ico /workspace/apps/mcp/public/icon.png ./public/

USER bun
EXPOSE 3009
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:3009/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["bun", "run", "dist/index.js"]
