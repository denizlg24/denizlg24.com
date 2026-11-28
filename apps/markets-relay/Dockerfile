FROM oven/bun:1.4.4-alpine AS prune
WORKDIR /workspace
RUN bun add --global turbo@2.11.9
COPY . .
RUN turbo prune markets-relay --docker

FROM oven/bun:1.4.4-alpine AS dependencies
WORKDIR /workspace
COPY --from=prune /workspace/out/json/ ./
RUN --mount=type=cache,id=forge-bun-install,target=/root/.bun/install/cache,sharing=locked \
  bun install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
COPY --from=prune /workspace/out/full/ ./
RUN bun run --cwd apps/markets-relay build

FROM ghcr.io/astral-sh/uv:0.11.25 AS uv
FROM python:3.12-slim-bookworm AS provider
WORKDIR /app/python
ENV UV_LINK_MODE=copy
COPY --from=uv /uv /usr/local/bin/uv
COPY apps/markets-relay/python/pyproject.toml apps/markets-relay/python/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-install-project

FROM oven/bun:1.4.4 AS bun-runtime
FROM python:3.12-slim-bookworm AS runtime
WORKDIR /app
RUN groupadd --system markets && useradd --system --gid markets markets
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
COPY --from=provider /app/python/.venv /app/python/.venv
COPY apps/markets-relay/python/provider.py apps/markets-relay/python/worker.py apps/markets-relay/python/zip_member.py ./python/

ENV NODE_ENV=production
ENV PORT=3004
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY --from=build /workspace/apps/markets-relay/dist ./dist

USER markets
EXPOSE 3004

CMD ["bun", "run", "dist/index.js"]
