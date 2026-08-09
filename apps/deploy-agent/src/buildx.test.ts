import { describe, expect, it } from "bun:test";

import { builderEndpoints, ensureBuildxBuilder } from "./buildx";
import type { ExecOptions, ExecResult } from "./exec";

const ENDPOINT = "docker-container://forge-buildkit";

function inspectOutput(endpoint: string): string {
  return [
    "Name:   forge-hdd",
    "Driver: remote",
    "",
    "Nodes:",
    "Name:      forge-hdd0",
    `Endpoint:  ${endpoint}`,
    "Status:    running",
  ].join("\n");
}

function scriptedExec(responses: Record<string, Partial<ExecResult>>) {
  const commands: string[][] = [];
  const exec = async (options: ExecOptions): Promise<ExecResult> => {
    commands.push([...options.command]);
    const scripted = responses[options.command.slice(0, 3).join(" ")] ?? {};
    return {
      exitCode: scripted.exitCode ?? 0,
      stdout: scripted.stdout ?? "",
      stderr: scripted.stderr ?? "",
      timedOut: false,
      aborted: false,
    };
  };
  return { exec, commands };
}

const SIGNAL = new AbortController().signal;

describe("builderEndpoints", () => {
  it("reads every node endpoint out of the inspect output", () => {
    expect(builderEndpoints(inspectOutput(ENDPOINT))).toEqual([ENDPOINT]);
  });

  it("returns nothing for a builder that declares no endpoint", () => {
    expect(builderEndpoints("Name: forge\nDriver: docker\n")).toEqual([]);
  });
});

describe("ensureBuildxBuilder", () => {
  it("keeps a builder already pointed at the endpoint", async () => {
    const { exec, commands } = scriptedExec({
      "docker buildx inspect": { stdout: inspectOutput(ENDPOINT) },
    });

    expect(
      await ensureBuildxBuilder(exec, SIGNAL, {
        name: "forge-hdd",
        endpoint: ENDPOINT,
      }),
    ).toBe(true);
    expect(commands).toHaveLength(1);
  });

  /**
   * The regression that stranded 111 GB on the runtime disk: the name resolved,
   * so the endpoint was never applied and every build kept using the old daemon.
   */
  it("recreates a builder left pointing at another daemon", async () => {
    const { exec, commands } = scriptedExec({
      "docker buildx inspect": {
        stdout: inspectOutput("docker-container://forge-old"),
      },
    });

    expect(
      await ensureBuildxBuilder(exec, SIGNAL, {
        name: "forge-hdd",
        endpoint: ENDPOINT,
      }),
    ).toBe(true);
    expect(commands.map((command) => command.slice(0, 3).join(" "))).toEqual([
      "docker buildx inspect",
      "docker buildx rm",
      "docker buildx create",
    ]);
    expect(commands[2]).toContain(ENDPOINT);
    expect(commands[2]).toContain("remote");
  });

  it("refuses rather than reusing a stale builder it could not remove", async () => {
    const { exec } = scriptedExec({
      "docker buildx inspect": {
        stdout: inspectOutput("docker-container://forge-old"),
      },
      "docker buildx rm": { exitCode: 1, stderr: "in use" },
    });

    expect(
      await ensureBuildxBuilder(exec, SIGNAL, {
        name: "forge-hdd",
        endpoint: ENDPOINT,
      }),
    ).toBe(false);
  });

  it("leaves an endpointless builder alone", async () => {
    const { exec, commands } = scriptedExec({
      "docker buildx inspect": { stdout: inspectOutput(ENDPOINT) },
    });

    expect(await ensureBuildxBuilder(exec, SIGNAL, { name: "forge" })).toBe(
      true,
    );
    expect(commands).toHaveLength(1);
  });
});
