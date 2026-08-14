FROM oven/bun:1.3.14-alpine AS dependencies
WORKDIR /workspace

COPY --parents package.json bun.lock apps/*/package.json packages/*/package.json ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
ARG NEXT_PUBLIC_CLOUD_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_CLOUD_API_URL=$NEXT_PUBLIC_CLOUD_API_URL
COPY apps apps
COPY packages packages
COPY scripts scripts
RUN --mount=type=secret,id=forge-env,required=false \
  if [ -f /run/secrets/forge-env ]; then . /run/secrets/forge-env; fi; \
  bun run --cwd apps/forge build

FROM node:24-alpine AS runtime
WORKDIR /app

ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV PORT=3006

COPY --from=build --chown=node:node /workspace/apps/forge/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/forge/.next/static ./apps/forge/.next/static
COPY --from=build --chown=node:node /workspace/apps/forge/public ./apps/forge/public

USER node
EXPOSE 3006
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3006/',{redirect:'manual'}).then(r=>process.exit(r.status>=200&&r.status<400?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "apps/forge/server.js"]
