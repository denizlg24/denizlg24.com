import { describe, expect, test } from "bun:test";
import {
  assertRuntimeSupported,
  ConfigError,
  configFromEnv,
  RUNSC_WRAPPER_PATH,
} from "./config";

const DIGEST = `ghcr.io/denizlg24/agent-runner-runtime@sha256:${"a".repeat(64)}`;

const base = {
  AGENT_RUNNER_OAUTH_CLIENT_ID: "agent-runner",
  AGENT_RUNNER_OAUTH_CLIENT_SECRET: "secret",
  AGENT_RUNNER_FORGE_HEALTH_URL: "http://100.64.0.2:4010/healthz",
  AGENT_RUNNER_RUNTIME_IMAGE: DIGEST,
  AGENT_RUNNER_GIT_NAME: "Sprint Agent",
  AGENT_RUNNER_GIT_EMAIL: "sprint@denizlg24.com",
  CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-x",
};

describe("configFromEnv", () => {
  test("defaults to the production endpoints and runsc", () => {
    const config = configFromEnv(base);
    expect(config.web.url).toBe("https://denizlg24.com");
    expect(config.api.resource).toBe("https://api.denizlg24.com");
    expect(config.oauth.issuer).toBe("https://api.denizlg24.com/api/auth");
    expect(config.containerRuntime).toBe("runsc");
    expect(config.maxConcurrent).toBe(2);
    expect(config.root).toBe("/mnt/storage/agent-runs");
  });

  test("refuses an image pinned by tag", () => {
    expect(() =>
      configFromEnv({
        ...base,
        AGENT_RUNNER_RUNTIME_IMAGE:
          "ghcr.io/denizlg24/agent-runner-runtime:latest",
      }),
    ).toThrow(ConfigError);
  });

  test("accepts a tag alongside the digest", () => {
    const image = `ghcr.io/denizlg24/agent-runner-runtime:abc@sha256:${"b".repeat(64)}`;
    expect(
      configFromEnv({ ...base, AGENT_RUNNER_RUNTIME_IMAGE: image }).image,
    ).toBe(image);
  });

  test("refuses an unknown runtime", () => {
    expect(() =>
      configFromEnv({ ...base, AGENT_RUNNER_CONTAINER_RUNTIME: "kata" }),
    ).toThrow(ConfigError);
  });

  test("refuses to start with no model credential", () => {
    const { CLAUDE_CODE_OAUTH_TOKEN: _, ...rest } = base;
    expect(() => configFromEnv(rest)).toThrow(ConfigError);
  });

  test("parses extra blocked addresses", () => {
    expect(
      configFromEnv({
        ...base,
        AGENT_RUNNER_BLOCKED_ADDRESSES: "203.0.113.7, 198.51.100.0/24",
      }).blockedAddresses,
    ).toEqual(["203.0.113.7", "198.51.100.0/24"]);
  });
});

describe("assertRuntimeSupported", () => {
  test("accepts runsc through the scoped wrapper", () => {
    expect(() =>
      assertRuntimeSupported(
        "runsc",
        JSON.stringify({
          runc: { path: "runc" },
          runsc: { path: RUNSC_WRAPPER_PATH },
        }),
      ),
    ).not.toThrow();
  });

  test("refuses plain runsc", () => {
    expect(() =>
      assertRuntimeSupported(
        "runsc",
        JSON.stringify({ runsc: { path: "/usr/bin/runsc" } }),
      ),
    ).toThrow(/silently ignored/);
  });

  test("runc needs no wrapper", () => {
    expect(() =>
      assertRuntimeSupported(
        "runc",
        JSON.stringify({
          runc: { path: "runc" },
          runsc: { path: "/usr/bin/runsc" },
        }),
      ),
    ).not.toThrow();
  });

  test("refuses a runtime the daemon lacks", () => {
    expect(() =>
      assertRuntimeSupported(
        "runsc",
        JSON.stringify({ runc: { path: "runc" } }),
      ),
    ).toThrow(ConfigError);
  });
});
