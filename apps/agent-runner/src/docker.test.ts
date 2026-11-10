import { describe, expect, test } from "bun:test";
import { Docker, parseRunContainers, RUN_LABEL, runArgs } from "./docker";
import type { ExecOptions } from "./exec";

describe("runArgs", () => {
  test("drops every capability and forbids privilege gain on every container", () => {
    const args = runArgs({
      image: "img@sha256:abc",
      runtime: "runsc",
      network: "agent-runs",
      user: "1000:1000",
      command: ["true"],
    });
    expect(args.join(" ")).toContain("--cap-drop ALL");
    expect(args.join(" ")).toContain("--security-opt no-new-privileges");
    expect(args.slice(-2)).toEqual(["img@sha256:abc", "true"]);
  });

  test("maps mounts, labels, limits and the env file", () => {
    const args = runArgs({
      name: "agent-run-1",
      image: "img",
      runtime: "runsc",
      network: "agent-runs",
      user: "1000:1000",
      labels: { [RUN_LABEL]: "1" },
      memory: "8g",
      memorySwap: "8g",
      cpus: 4,
      pidsLimit: 4096,
      readOnly: true,
      tmpfs: ["/tmp:rw,exec"],
      mounts: [{ source: "/c", target: "/run/creds", readOnly: true }],
      envFile: "/state/1.env",
      entrypoint: "claude",
      command: ["-p", "x"],
      detach: true,
    });
    const joined = args.join(" ");
    for (const expected of [
      "--detach",
      "--name agent-run-1",
      `--label ${RUN_LABEL}=1`,
      "--memory 8g",
      "--memory-swap 8g",
      "--cpus 4",
      "--pids-limit 4096",
      "--read-only",
      "--tmpfs /tmp:rw,exec",
      "--volume /c:/run/creds:ro",
      "--env-file /state/1.env",
      "--entrypoint claude",
    ]) {
      expect(joined).toContain(expected);
    }
  });
});

describe("parseRunContainers", () => {
  test("keeps only labelled containers", () => {
    const output = [
      JSON.stringify({
        ID: "abc",
        Names: "agent-run-r1",
        State: "running",
        Labels: `${RUN_LABEL}=r1,other=x`,
      }),
      JSON.stringify({
        ID: "def",
        Names: "x",
        State: "exited",
        Labels: "other=y",
      }),
      "not json",
    ].join("\n");
    expect(parseRunContainers(output)).toEqual([
      { id: "abc", name: "agent-run-r1", runId: "r1", state: "running" },
    ]);
  });
});

describe("Docker.wait", () => {
  test("takes the caller's deadline instead of the two-minute CLI timeout", async () => {
    const calls: { argv: string[]; options?: ExecOptions }[] = [];
    const docker = new Docker(async (argv, options) => {
      calls.push({ argv, options });
      return { exitCode: 0, stdout: "0\n", stderr: "", timedOut: false };
    });
    expect(await docker.wait("agent-run-1", { timeoutMs: 90 * 60_000 })).toBe(
      0,
    );
    expect(calls[0]?.argv).toEqual(["docker", "wait", "agent-run-1"]);
    expect(calls[0]?.options?.timeoutMs).toBe(90 * 60_000);
  });

  test("a wait that outlives its deadline throws rather than returning a code", async () => {
    const docker = new Docker(async () => ({
      exitCode: 137,
      stdout: "",
      stderr: "",
      timedOut: true,
    }));
    await expect(docker.wait("agent-run-1", { timeoutMs: 1 })).rejects.toThrow(
      "outlived the run's deadline",
    );
  });

  test("throws when docker wait itself fails", async () => {
    const docker = new Docker(async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "Error: No such container: agent-run-1",
      timedOut: false,
    }));
    await expect(docker.wait("agent-run-1")).rejects.toThrow(
      "No such container",
    );
  });
});
