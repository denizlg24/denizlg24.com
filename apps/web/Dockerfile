# glibc in both stages, unlike the other Next apps here: the Tectonic binary
# node-latex-compiler ships is dynamically linked against glibc, libssl 3 and
# graphite2, and bun installs the platform packages of sharp and resvg for the
# libc it runs on, so an alpine install stage would hand a Debian runtime the
# musl builds.
FROM oven/bun:1.4.0-slim AS dependencies
WORKDIR /workspace

COPY --parents package.json bun.lock apps/*/package.json packages/*/package.json ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
COPY apps apps
COPY packages packages
COPY scripts scripts
RUN --mount=type=secret,id=forge-env,required=false \
  if [ -f /run/secrets/forge-env ]; then set -a; . /run/secrets/forge-env; set +a; fi; \
  bun run --cwd apps/web build
# Tectonic lives in a platform package whose require Next cannot trace into the
# standalone output. Pin it to a fixed path for the runtime stage, and fail the
# build here rather than ship an image whose CV compile discovers the gap.
RUN tectonic="$(find /workspace -path '*/@node-latex-compiler/bin-linux-x64/bin/tectonic' -print -quit)" \
  && test -n "$tectonic" \
  && cp "$tectonic" /workspace/tectonic

# trixie, not bookworm: the Tectonic binary wants glibc 2.39 and bookworm ships
# 2.36. ca-certificates is for the TeX bundle it fetches over HTTPS on first use.
FROM node:24-trixie-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends libssl3t64 libgraphite2-3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV PORT=3000
ENV LATEX_TECTONIC_PATH=/usr/local/bin/tectonic

COPY --from=build /workspace/tectonic /usr/local/bin/tectonic
COPY --from=build --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /workspace/apps/web/public ./apps/web/public
# Read from process.cwd() by the whiteboard renderer; server.js chdirs to apps/web.
COPY --from=build --chown=node:node /workspace/apps/web/assets ./apps/web/assets

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/',{redirect:'manual'}).then(r=>process.exit(r.status>=200&&r.status<400?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "apps/web/server.js"]
