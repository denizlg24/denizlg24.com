import { afterEach, describe, expect, it } from "bun:test";

import { agentConfigFromEnv, isPrivateBindAddress } from "./config";

const BASE_ENV: Record<string, string> = {
  AGENT_BIND_ADDRESS: "100.64.0.1",
  AGENT_TOKEN: "x".repeat(32),
  CONTROL_PLANE_URL: "https://api.denizlg24.com",
};

const TOUCHED = [
  "AGENT_BIND_ADDRESS",
  "AGENT_TOKEN",
  "AGENT_PORT",
  "CONTROL_PLANE_URL",
  "MAX_CONCURRENT_BUILDS",
  "CLAIM_POLL_MS",
  "HEARTBEAT_MS",
  "BUILD_ROOT",
  "LOG_ROOT",
  "CACHE_ROOT",
  "DOCKER_SOCKET",
  "DOCKER_DATA_ROOT",
];

function configWith(overrides: Record<string, string | undefined> = {}) {
  for (const name of TOUCHED) delete process.env[name];
  for (const [name, value] of Object.entries({ ...BASE_ENV, ...overrides })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  return agentConfigFromEnv();
}

afterEach(() => {
  for (const name of TOUCHED) delete process.env[name];
});

describe("isPrivateBindAddress", () => {
  it("accepts loopback, private and CGNAT addresses", () => {
    expect(isPrivateBindAddress("127.0.0.1")).toBe(true);
    expect(isPrivateBindAddress("::1")).toBe(true);
    expect(isPrivateBindAddress("10.1.2.3")).toBe(true);
    expect(isPrivateBindAddress("172.16.0.1")).toBe(true);
    expect(isPrivateBindAddress("192.168.1.4")).toBe(true);
    expect(isPrivateBindAddress("169.254.1.1")).toBe(true);
    expect(isPrivateBindAddress("100.64.0.1")).toBe(true);
  });

  it("rejects publicly routable addresses", () => {
    expect(isPrivateBindAddress("8.8.8.8")).toBe(false);
    expect(isPrivateBindAddress("172.32.0.1")).toBe(false);
    expect(isPrivateBindAddress("100.128.0.1")).toBe(false);
    expect(isPrivateBindAddress("not-an-address")).toBe(false);
  });
});

describe("agentConfigFromEnv", () => {
  it("applies documented defaults", () => {
    const config = configWith();
    expect(config.port).toBe(4_010);
    expect(config.maxConcurrentBuilds).toBe(1);
    expect(config.claimPollMs).toBe(3_000);
    expect(config.buildRoot).toBe("/srv/forge/builds");
    expect(config.dockerSocket).toBe("/var/run/docker.sock");
    expect(config.dockerDataRoot).toBe("/var/lib/docker");
  });

  it("refuses a wildcard bind address", () => {
    expect(() => configWith({ AGENT_BIND_ADDRESS: "0.0.0.0" })).toThrow(
      /wildcard/,
    );
    expect(() => configWith({ AGENT_BIND_ADDRESS: "::" })).toThrow(/wildcard/);
  });

  it("refuses a publicly routable bind address", () => {
    expect(() => configWith({ AGENT_BIND_ADDRESS: "8.8.8.8" })).toThrow(
      /loopback, private/,
    );
  });

  it("refuses a missing bind address rather than defaulting to one", () => {
    expect(() => configWith({ AGENT_BIND_ADDRESS: undefined })).toThrow(
      /AGENT_BIND_ADDRESS/,
    );
  });

  it("refuses a short token", () => {
    expect(() => configWith({ AGENT_TOKEN: "short" })).toThrow(/32 characters/);
  });

  it("refuses a non-http control plane URL", () => {
    expect(() =>
      configWith({ CONTROL_PLANE_URL: "ftp://example.com" }),
    ).toThrow(/http or https/);
    expect(() => configWith({ CONTROL_PLANE_URL: "not a url" })).toThrow(
      /absolute URL/,
    );
  });

  it("strips trailing slashes from the control plane URL", () => {
    const config = configWith({
      CONTROL_PLANE_URL: "https://api.denizlg24.com///",
    });
    expect(config.controlPlaneUrl).toBe("https://api.denizlg24.com");
  });

  it("bounds concurrency", () => {
    expect(configWith({ MAX_CONCURRENT_BUILDS: "4" }).maxConcurrentBuilds).toBe(
      4,
    );
    expect(() => configWith({ MAX_CONCURRENT_BUILDS: "0" })).toThrow(
      /integer from 1 to 4/,
    );
    expect(() => configWith({ MAX_CONCURRENT_BUILDS: "9" })).toThrow(
      /integer from 1 to 4/,
    );
  });

  it("requires absolute paths", () => {
    expect(() => configWith({ BUILD_ROOT: "relative/path" })).toThrow(
      /absolute path/,
    );
  });
});
