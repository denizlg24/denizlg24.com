# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.3-alpine AS dependencies
WORKDIR /workspace

COPY package.json bun.lock ./
COPY apps/markets-relay/package.json apps/markets-relay/package.json
COPY packages/markets/package.json packages/markets/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json

RUN bun install --frozen-lockfile --ignore-scripts --filter 'markets-relay...'

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
