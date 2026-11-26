import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:3290";
process.env.STOCKWATCHER_TEST_DB ??= join(
  tmpdir(),
  `stockwatcher-test-${randomUUID()}.sqlite`,
);
export default defineConfig({
  testDir: "tests",
  workers: 1,
  use: { baseURL, channel: process.env.PLAYWRIGHT_CHANNEL || undefined },
  webServer: [
    {
      command: "node tests/oidc-fixture.mjs",
      url: "http://127.0.0.1:3291/oidc/.well-known/openid-configuration",
    },
    {
      command: "node tests/flex-fixture.mjs",
      url: "http://127.0.0.1:3292/health",
    },
    {
      command: "bun run dev --hostname 127.0.0.1 --port 3290",
      url: `${baseURL}/api/health`,
      env: {
        APP_URL: baseURL,
        DENIZ_OIDC_ISSUER: "http://127.0.0.1:3291/oidc",
        DENIZ_OIDC_CLIENT_ID: "TestStockwatcherClient",
        DENIZ_OIDC_CLIENT_SECRET: "TestStockwatcherSecret",
        OIDC_TEST_ALLOW_HTTP: "1",
        DEMO_MODE: "1",
        STOCKWATCHER_DB_PATH: process.env.STOCKWATCHER_TEST_DB,
        ALERT_MONITOR: "0",
        BROKER_SYNC: "0",
        IBKR_FLEX_URL: "http://127.0.0.1:3292/flex",
        // `tests/billing.spec.ts` runs against Postgres and the real gateway
        // when STOCKWATCHER_E2E_DATABASE_URL and STOCKWATCHER_E2E_AI_KEY are set.
        DATABASE_URL: process.env.STOCKWATCHER_E2E_DATABASE_URL ?? "",
        BILLING: process.env.STOCKWATCHER_E2E_DATABASE_URL ? "1" : "0",
        AI_GATEWAY_API_KEY: process.env.STOCKWATCHER_E2E_AI_KEY ?? "",
        AI_GATEWAY_MODEL: "anthropic/claude-haiku-4.5",
        REQUIRE_DATABASE_URL: "0",
      },
    },
  ],
});
