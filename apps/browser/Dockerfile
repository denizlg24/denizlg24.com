FROM oven/bun:1.4.0-debian AS dependencies
WORKDIR /workspace

COPY --parents package.json bun.lock apps/*/package.json packages/*/package.json ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
COPY apps/browser apps/browser
RUN bun run --cwd apps/browser build

# Debian, not alpine: Google Chrome is a glibc build and Playwright's
# `install --with-deps` only knows apt. amd64 only — Chrome ships no linux/arm64.
FROM oven/bun:1.4.0-debian AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3010
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV BROWSER_OUTPUT_DIR=/tmp/browser-output
ENV DISPLAY=:99
# Where Forge's egress IP geolocates (Vodafone PT). A timezone that disagrees
# with the IP is one of the cheaper bot signals.
ENV TZ=Europe/Lisbon
ENV BROWSER_TIMEZONE=Europe/Lisbon

# The bundle leaves Playwright and its MCP server external — they spawn the
# browser and read their own package tree — so those two are installed here
# at the exact versions apps/browser/package.json pins. Everything else is in
# dist, and the workspace devDependencies cannot resolve outside the monorepo.
COPY apps/browser/package.json ./manifest.json
RUN bun -e 'const p = JSON.parse(await Bun.file("manifest.json").text()); const keep = ["playwright", "@playwright/mcp"]; await Bun.write("package.json", JSON.stringify({ dependencies: Object.fromEntries(keep.map((name) => [name, p.dependencies[name]])) }))' \
  && rm manifest.json \
  && bun install \
  && bunx playwright install --with-deps chrome \
  && apt-get update \
  && apt-get install -y --no-install-recommends xvfb xauth fonts-liberation fonts-noto-core fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /tmp/browser-output /tmp/.X11-unix \
  && chmod 1777 /tmp/.X11-unix \
  && chown -R bun:bun /tmp/browser-output /app

COPY --from=build --chown=bun:bun /workspace/apps/browser/dist ./dist
COPY --chmod=0755 apps/browser/docker-entrypoint.sh /usr/local/bin/browser-entrypoint

USER bun
EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:3010/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["browser-entrypoint"]
