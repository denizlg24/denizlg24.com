# syntax=docker/dockerfile:1.7

FROM oven/bun:1.4.4-alpine AS manifests
WORKDIR /src
COPY . .
# Bun 1.3.3 needs the complete workspace manifest set for a frozen install.
# Expanding the root `workspaces` globs here means a new app needs no edit to
# this file; the stage reruns on every source change, but the COPY --from below
# is content-addressed, so the install layer is reused until a manifest changes.
RUN bun -e 'const { mkdirSync, copyFileSync } = require("node:fs"); const { dirname } = require("node:path"); for (const pattern of require("./package.json").workspaces) for (const manifest of new Bun.Glob(`${pattern}/package.json`).scanSync(".")) { mkdirSync(`/manifests/${dirname(manifest)}`, { recursive: true }); copyFileSync(manifest, `/manifests/${manifest}`); }'

FROM oven/bun:1.4.4-alpine AS dependencies
WORKDIR /workspace

COPY package.json bun.lock ./
COPY --from=manifests /manifests/ ./

RUN bun install --frozen-lockfile --ignore-scripts --filter markets-relay

FROM dependencies AS build
COPY apps/markets-relay apps/markets-relay
COPY packages/markets packages/markets
RUN bun run --cwd apps/markets-relay build

FROM ghcr.io/astral-sh/uv:0.11.25 AS uv
FROM python:3.12-slim-bookworm AS provider
WORKDIR /app/python
COPY --from=uv /uv /usr/local/bin/uv
COPY apps/markets-relay/python/pyproject.toml apps/markets-relay/python/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

FROM oven/bun:1.4.4 AS bun-runtime
FROM python:3.12-slim-bookworm AS runtime
WORKDIR /app
RUN groupadd --system markets && useradd --system --gid markets markets
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
COPY --from=provider /app/python/.venv /app/python/.venv
COPY apps/markets-relay/python/provider.py apps/markets-relay/python/worker.py ./python/

ENV NODE_ENV=production
ENV PORT=3004
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY --from=build /workspace/apps/markets-relay/dist ./dist

USER markets
EXPOSE 3004

CMD ["bun", "run", "dist/index.js"]
