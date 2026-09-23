FROM oven/bun:1.4.0-debian AS dependencies
WORKDIR /workspace

COPY --parents package.json bun.lock apps/*/package.json packages/*/package.json ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
COPY apps/browser apps/browser
RUN bun run --cwd apps/browser build

# Debian, not alpine: Playwright's Chromium is a glibc build and its
# `install --with-deps` only knows apt.
FROM oven/bun:1.4.0-debian AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3010
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV BROWSER_OUTPUT_DIR=/tmp/browser-output

# The bundle leaves Playwright and its MCP server external — they spawn the
# browser and read their own package tree — so those two are installed here
# at the exact versions apps/browser/package.json pins. Everything else is in
# dist, and the workspace devDependencies cannot resolve outside the monorepo.
COPY apps/browser/package.json ./manifest.json
RUN bun -e 'const p = JSON.parse(await Bun.file("manifest.json").text()); const keep = ["playwright", "@playwright/mcp"]; await Bun.write("package.json", JSON.stringify({ dependencies: Object.fromEntries(keep.map((name) => [name, p.dependencies[name]])) }))' \
  && rm manifest.json \
  && bun install \
  && bunx playwright install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /tmp/browser-output \
  && chown -R bun:bun /tmp/browser-output /app

COPY --from=build --chown=bun:bun /workspace/apps/browser/dist ./dist

USER bun
EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:3010/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["bun", "run", "dist/index.js"]
