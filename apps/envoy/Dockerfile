FROM oven/bun:1.4.0-alpine AS dependencies
WORKDIR /workspace

COPY --parents package.json bun.lock apps/*/package.json packages/*/package.json ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
COPY apps apps
COPY packages packages
COPY scripts scripts
# Migrations run here, before the build, exactly as the target's old build
# command did on nixpacks: the deploy env (ENVOY_DATABASE_URL among it) arrives
# through the secret mount, and a build that cannot migrate must not ship.
RUN --mount=type=secret,id=forge-env,required=false \
  if [ -f /run/secrets/forge-env ]; then set -a; . /run/secrets/forge-env; set +a; fi; \
  bun run --cwd apps/envoy db:migrate && bun run --cwd apps/envoy build

FROM node:24-alpine AS runtime
WORKDIR /app

ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV PORT=3006

COPY --from=build --chown=node:node /workspace/apps/envoy/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/envoy/.next/static ./apps/envoy/.next/static
COPY --from=build --chown=node:node /workspace/apps/envoy/public ./apps/envoy/public

USER node
EXPOSE 3006
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3006/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "apps/envoy/server.js"]
