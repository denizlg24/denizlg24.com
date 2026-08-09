# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.3-alpine AS dependencies
WORKDIR /workspace

COPY package.json bun.lock ./
COPY apps apps
COPY packages packages
COPY scripts scripts

RUN bun install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
ARG NEXT_PUBLIC_CLOUD_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_CLOUD_API_URL=$NEXT_PUBLIC_CLOUD_API_URL
RUN bun run --cwd apps/forge build

FROM node:24-alpine AS runtime
WORKDIR /app

ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV PORT=3006

COPY --from=build --chown=node:node /workspace/apps/forge/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/forge/.next/static ./apps/forge/.next/static

USER node
EXPOSE 3006

CMD ["node", "apps/forge/server.js"]
