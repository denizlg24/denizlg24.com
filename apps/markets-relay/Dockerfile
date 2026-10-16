# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.3-alpine AS manifests
WORKDIR /src
COPY . .
# Bun 1.3.3 needs the complete workspace manifest set for a frozen install.
# Expanding the root `workspaces` globs here means a new app needs no edit to
# this file; the stage reruns on every source change, but the COPY --from below
# is content-addressed, so the install layer is reused until a manifest changes.
RUN bun -e 'const { mkdirSync, copyFileSync } = require("node:fs"); const { dirname } = require("node:path"); for (const pattern of require("./package.json").workspaces) for (const manifest of new Bun.Glob(`${pattern}/package.json`).scanSync(".")) { mkdirSync(`/manifests/${dirname(manifest)}`, { recursive: true }); copyFileSync(manifest, `/manifests/${manifest}`); }'

FROM oven/bun:1.3.3-alpine AS dependencies
WORKDIR /workspace

COPY package.json bun.lock ./
COPY --from=manifests /manifests/ ./

RUN bun install --frozen-lockfile --ignore-scripts --filter markets-relay

FROM dependencies AS build
COPY apps/markets-relay apps/markets-relay
COPY packages/markets packages/markets
RUN bun run --cwd apps/markets-relay build

FROM oven/bun:1.3.3-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3004

COPY --from=build --chown=bun:bun /workspace/apps/markets-relay/dist ./dist

USER bun
EXPOSE 3004

CMD ["bun", "run", "dist/index.js"]
