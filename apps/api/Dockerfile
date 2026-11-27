FROM oven/bun:1.4.4-alpine AS prune
WORKDIR /workspace
RUN bun add --global turbo@2.11.9
COPY . .
RUN turbo prune api --docker

FROM oven/bun:1.4.4-alpine AS dependencies
WORKDIR /workspace
COPY --from=prune /workspace/out/json/ ./
RUN --mount=type=cache,id=forge-bun-install,target=/root/.bun/install/cache,sharing=locked \
  bun install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
COPY --from=prune /workspace/out/full/ ./
RUN bun run --cwd apps/api build

FROM oven/bun:1.4.4-alpine AS runtime
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
