FROM oven/bun:1.4.4-alpine AS prune
WORKDIR /workspace
RUN bun add --global turbo@2.11.9
COPY . .
RUN turbo prune sandbox --docker

FROM oven/bun:1.4.4-alpine AS dependencies
WORKDIR /workspace
COPY --from=prune /workspace/out/json/ ./
RUN --mount=type=cache,id=forge-bun-install,target=/root/.bun/install/cache,sharing=locked \
  bun install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
COPY --from=prune /workspace/out/full/ ./
RUN bun run --cwd apps/sandbox build

FROM oven/bun:1.4.4-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache docker-cli

ENV NODE_ENV=production
ENV PORT=3005

COPY --from=build --chown=bun:bun /workspace/apps/sandbox/dist ./dist

USER bun
EXPOSE 3005

CMD ["bun", "run", "dist/index.js"]
