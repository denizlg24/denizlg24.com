FROM oven/bun:1.4.0-alpine AS dependencies
WORKDIR /workspace

COPY --parents package.json bun.lock apps/*/package.json apps/nutrition/frontend/package.json packages/*/package.json ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
COPY apps/nutrition apps/nutrition
COPY packages packages
RUN bun run --cwd apps/nutrition build \
  && bun run --cwd apps/nutrition/frontend build

FROM oven/bun:1.4.0-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build --chown=bun:bun /workspace/apps/nutrition/dist ./dist
COPY --from=build --chown=bun:bun /workspace/apps/nutrition/frontend/dist ./frontend/dist

USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["bun", "run", "dist/index.js"]
