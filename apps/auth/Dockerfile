FROM oven/bun:1.4.4-alpine AS prune
WORKDIR /workspace
RUN bun add --global turbo@2.11.9
COPY . .
RUN turbo prune auth --docker

FROM oven/bun:1.4.4-alpine AS dependencies
WORKDIR /workspace
COPY --from=prune /workspace/out/json/ ./
RUN --mount=type=cache,id=forge-bun-install,target=/root/.bun/install/cache,sharing=locked \
  bun install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
# The pages talk to the cloud API straight from the browser, so its URL is
# compiled in. The cloud-ui fallback is the local dev API on purpose: a build
# that forgot this breaks loudly instead of pointing at production.
ARG NEXT_PUBLIC_CLOUD_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_CLOUD_API_URL=$NEXT_PUBLIC_CLOUD_API_URL
COPY --from=prune /workspace/out/full/ ./
RUN --mount=type=secret,id=forge-env,required=false \
  --mount=type=cache,id=forge-next-auth,target=/workspace/apps/auth/.next/cache,sharing=locked \
  if [ -f /run/secrets/forge-env ]; then set -a; . /run/secrets/forge-env; set +a; fi; \
  bun run --cwd apps/auth build

FROM node:24-alpine AS runtime
WORKDIR /app

ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV PORT=3008

COPY --from=build --chown=node:node /workspace/apps/auth/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/auth/.next/static ./apps/auth/.next/static

USER node
EXPOSE 3008
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3008/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "apps/auth/server.js"]
