import { describe, expect, test } from "bun:test";
import { parseRunContainers, RUN_LABEL, runArgs } from "./docker";

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
