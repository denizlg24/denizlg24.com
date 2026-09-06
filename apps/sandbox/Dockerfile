# syntax=docker/dockerfile:1.7

FROM oven/bun:1.4.0-alpine AS dependencies
WORKDIR /workspace

COPY package.json bun.lock ./
COPY apps apps
COPY packages packages

RUN bun install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
RUN bun run --cwd apps/sandbox build

FROM oven/bun:1.4.0-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache docker-cli

ENV NODE_ENV=production
ENV PORT=3005

COPY --from=build --chown=bun:bun /workspace/apps/sandbox/dist ./dist

USER bun
EXPOSE 3005

CMD ["bun", "run", "dist/index.js"]
