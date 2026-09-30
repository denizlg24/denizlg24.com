# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.3-alpine AS dependencies
WORKDIR /workspace

COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY packages/cloud-auth-client/package.json packages/cloud-auth-client/package.json
COPY packages/cloud-core/package.json packages/cloud-core/package.json
COPY packages/markets/package.json packages/markets/package.json
COPY packages/schemas/package.json packages/schemas/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json

RUN bun install --frozen-lockfile --ignore-scripts --filter 'api...'

FROM dependencies AS build
COPY apps/api apps/api
COPY packages/cloud-auth-client packages/cloud-auth-client
COPY packages/cloud-core packages/cloud-core
COPY packages/markets packages/markets
COPY packages/schemas packages/schemas
RUN bun run --cwd apps/api build

FROM oven/bun:1.3.3-alpine AS runtime
WORKDIR /app

# Thumbnails are subprocesses, never a native module: `vipsthumbnail` for
# images and PDFs (`vips-heif` decodes iPhone HEIC, `vips-poppler` rasterizes
# a first page), `ffmpeg` for a video poster frame. About 90 MB on arm64.
RUN apk add --no-cache vips-tools vips-heif vips-poppler ffmpeg

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
