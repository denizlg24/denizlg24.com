# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.3-alpine AS dependencies
WORKDIR /workspace

COPY package.json bun.lock ./
# Bun 1.3.3 needs the complete workspace manifest set for a frozen install.
# Source files stay in the build stage so code edits reuse this layer.
COPY apps/api/package.json apps/api/package.json
COPY apps/auth/package.json apps/auth/package.json
COPY apps/authenticator-extension/package.json apps/authenticator-extension/package.json
COPY apps/browser/package.json apps/browser/package.json
COPY apps/cloud/package.json apps/cloud/package.json
COPY apps/deploy-agent/package.json apps/deploy-agent/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/envoy/package.json apps/envoy/package.json
COPY apps/forge/package.json apps/forge/package.json
COPY apps/hours-mobile/package.json apps/hours-mobile/package.json
COPY apps/macros-mobile/package.json apps/macros-mobile/package.json
COPY apps/macros-admin/package.json apps/macros-admin/package.json
COPY apps/macros/package.json apps/macros/package.json
COPY apps/markets-relay/package.json apps/markets-relay/package.json
COPY apps/mcp/package.json apps/mcp/package.json
COPY apps/nutrition/package.json apps/nutrition/package.json
COPY apps/nutrition/frontend/package.json apps/nutrition/frontend/package.json
COPY apps/sandbox/package.json apps/sandbox/package.json
COPY apps/status/package.json apps/status/package.json
COPY apps/storage-metadata/package.json apps/storage-metadata/package.json
COPY apps/storage/package.json apps/storage/package.json
COPY apps/terminal/package.json apps/terminal/package.json
COPY apps/voice-mobile/package.json apps/voice-mobile/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/admin/package.json packages/admin/package.json
COPY packages/auth-sdk/package.json packages/auth-sdk/package.json
COPY packages/auth-ui/package.json packages/auth-ui/package.json
COPY packages/cloud-auth-client/package.json packages/cloud-auth-client/package.json
COPY packages/cloud-core/package.json packages/cloud-core/package.json
COPY packages/cloud-ui/package.json packages/cloud-ui/package.json
COPY packages/expo-ios-targets/package.json packages/expo-ios-targets/package.json
COPY packages/latex-editor/package.json packages/latex-editor/package.json
COPY packages/macros-core/package.json packages/macros-core/package.json
COPY packages/markets/package.json packages/markets/package.json
COPY packages/native-auth/package.json packages/native-auth/package.json
COPY packages/schemas/package.json packages/schemas/package.json
COPY packages/tts/package.json packages/tts/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/utils/package.json packages/utils/package.json
COPY packages/whiteboard-render/package.json packages/whiteboard-render/package.json

RUN bun install --frozen-lockfile --ignore-scripts --filter markets-relay

FROM dependencies AS build
COPY apps/markets-relay apps/markets-relay
COPY packages/markets packages/markets
RUN bun run --cwd apps/markets-relay build

FROM oven/bun:1.3.3-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3004

COPY --from=build --chown=bun:bun /workspace/apps/markets-relay/dist ./dist

USER bun
EXPOSE 3004

CMD ["bun", "run", "dist/index.js"]
