import { describe, expect, it } from "bun:test";
import { readConfig } from "./config";

describe("sandbox configuration", () => {
  it("refuses the ordinary Docker runtime in production", () => {
    expect(() =>
      readConfig({
        NODE_ENV: "production",
        SANDBOX_API_TOKEN: "x".repeat(32),
        SANDBOX_DOCKER_HOST: "unix:///run/user/1001/docker.sock",
        SANDBOX_CONTAINER_RUNTIME: "runc",
      }),
    ).toThrow("requires SANDBOX_CONTAINER_RUNTIME=runsc");
  });

  it("requires an immutable runtime image in production", () => {
    expect(() =>
      readConfig({
        NODE_ENV: "production",
        SANDBOX_API_TOKEN: "x".repeat(32),
        SANDBOX_DOCKER_HOST: "unix:///run/user/1001/docker.sock",
        SANDBOX_CONTAINER_RUNTIME: "runsc",
        SANDBOX_RUNTIME_IMAGE: "ghcr.io/denizlg24/agent-sandbox-runtime:latest",
      }),
    ).toThrow("immutable sha256 digest");
  });

  it("cannot inherit Forge's system daemon in production", () => {
    expect(() =>
      readConfig({
        NODE_ENV: "production",
        SANDBOX_API_TOKEN: "x".repeat(32),
        SANDBOX_CONTAINER_RUNTIME: "runsc",
        SANDBOX_RUNTIME_IMAGE: `runtime@sha256:${"a".repeat(64)}`,
      }),
    ).toThrow("dedicated sandbox daemon");
  });
});
