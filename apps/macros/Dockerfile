FROM oven/bun:1.3.14-alpine AS dependencies
WORKDIR /workspace

COPY --parents package.json bun.lock apps/*/package.json packages/*/package.json ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
COPY apps apps
COPY packages packages
RUN --mount=type=secret,id=forge-env,required=false \
  if [ -f /run/secrets/forge-env ]; then set -a; . /run/secrets/forge-env; set +a; fi; \
  bun run --cwd apps/macros build

FROM node:24-alpine AS runtime
WORKDIR /app

ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build --chown=node:node /workspace/apps/macros/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/macros/.next/static ./apps/macros/.next/static
COPY --from=build --chown=node:node /workspace/apps/macros/public ./apps/macros/public

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "apps/macros/server.js"]
