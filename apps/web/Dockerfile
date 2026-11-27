# glibc in both stages, unlike the other Next apps here: the Tectonic binary
# node-latex-compiler ships is dynamically linked against glibc, libssl 3 and
# graphite2, and bun installs the platform packages of sharp and resvg for the
# libc it runs on, so an alpine install stage would hand a Debian runtime the
# musl builds. The prune stage only emits text, so its libc is irrelevant.
FROM oven/bun:1.4.4-alpine AS prune
WORKDIR /workspace
RUN bun add --global turbo@2.11.9
COPY . .
RUN turbo prune web --docker

FROM oven/bun:1.4.4-slim AS dependencies
WORKDIR /workspace

COPY --from=prune /workspace/out/json/ ./
RUN --mount=type=cache,id=forge-bun-install,target=/root/.bun/install/cache,sharing=locked \
  bun install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
COPY --from=prune /workspace/out/full/ ./
RUN --mount=type=secret,id=forge-env,required=false \
  --mount=type=cache,id=forge-next-web,target=/workspace/apps/web/.next/cache,sharing=locked \
  if [ -f /run/secrets/forge-env ]; then set -a; . /run/secrets/forge-env; set +a; fi; \
  bun run --cwd apps/web build
# Tectonic lives in a platform package whose require Next cannot trace into the
# standalone output. Pin it to a fixed path for the runtime stage, and fail the
# build here rather than ship an image whose CV compile discovers the gap.
RUN tectonic="$(find /workspace/node_modules -path '*/@node-latex-compiler/bin-linux-x64/bin/tectonic' -print -quit)" \
  && test -n "$tectonic" \
  && cp "$tectonic" /workspace/tectonic
# The Agent SDK starts Anthropic's unmodified native runtime. Optional platform
# packages cannot be inferred reliably by Next's standalone file tracing.
RUN case "$(uname -m)" in x86_64) claude_arch=x64 ;; aarch64) claude_arch=arm64 ;; *) exit 1 ;; esac \
  && claude_binary="$(find /workspace/node_modules/.bun -path "*/@anthropic-ai/claude-agent-sdk-linux-${claude_arch}/claude" -type f -print -quit)" \
  && test -n "$claude_binary" && test -x "$claude_binary" \
  && cp "$claude_binary" /workspace/claude-agent

# trixie, not bookworm: the Tectonic binary wants glibc 2.39 and bookworm ships
# 2.36. ca-certificates is for the TeX bundle it fetches over HTTPS on first use.
# fontconfig-config is only /etc/fonts/fonts.conf: without it xdvipdfmx prints
# "Fontconfig error: Cannot load default config file" into every compile log.
FROM node:24-trixie-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends libssl3t64 libgraphite2-3 ca-certificates fontconfig-config \
  && rm -rf /var/lib/apt/lists/*

ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV PORT=3000
ENV LATEX_TECTONIC_PATH=/usr/local/bin/tectonic
ENV FFMPEG_PATH=/usr/local/bin/ffmpeg
ENV CLAUDE_CODE_EXECUTABLE=/usr/local/bin/claude-agent

COPY --from=build /workspace/tectonic /usr/local/bin/tectonic
COPY --from=build /workspace/claude-agent /usr/local/bin/claude-agent
# Static build, so it needs nothing from trixie. Voice transcription splits long
# recordings with it: the model refuses anything much past twenty minutes.
COPY --from=mwader/static-ffmpeg:8.0.1 /ffmpeg /usr/local/bin/ffmpeg
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
