# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.3-alpine AS dependencies
WORKDIR /workspace

COPY package.json bun.lock ./
COPY apps apps
COPY packages packages

RUN bun install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
RUN bun run --cwd apps/api build

FROM oven/bun:1.3.3-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY --from=build --chown=bun:bun /workspace/apps/api/dist ./dist
# The migration runner is bundled next to the server so a deploy can apply
# schema changes from the same immutable image it is about to start. The SQL
# lives outside the bundle, so it has to be copied and pointed at explicitly.
COPY --from=build --chown=bun:bun /workspace/packages/cloud-core/drizzle ./drizzle
ENV DRIZZLE_MIGRATIONS_DIR=/app/drizzle

USER bun
EXPOSE 3001

CMD ["bun", "run", "dist/index.js"]
