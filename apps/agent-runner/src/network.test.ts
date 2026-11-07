import { describe, expect, test } from "bun:test";
import type { Docker } from "./docker";
import type { CommandRunner } from "./exec";
import {
  applyEgressRules,
  BLOCKED_V4,
  blockedCidrs,
  EgressError,
  egressCommand,
  parseChildPid,
  resolvConf,
  verifyEgressRules,
} from "./network";

const BRIDGE = "agent-runs0";

function readBack(cidrs: string[], userLines: string[], inputLines: string[]) {
  return [
    "=== egress",
    "-N AGENT-RUNS-EGRESS",
    ...cidrs.map((cidr) => `-A AGENT-RUNS-EGRESS -d ${cidr} -j DROP`),
    "=== docker-user",
    "-N DOCKER-USER",
    ...userLines,
    "=== input",
    "-P INPUT ACCEPT",
    ...inputLines,
  ].join("\n");
}

const JUMP = `-A DOCKER-USER -i ${BRIDGE} -j AGENT-RUNS-EGRESS`;
const INPUT_DROP = `-A INPUT -i ${BRIDGE} -j DROP`;

describe("blockedCidrs", () => {
  test("adds the host's own addresses as /32 and drops IPv6 entries", () => {
    const cidrs = blockedCidrs(["203.0.113.7", "2001:db8::1"]);
    expect(cidrs).toContain("203.0.113.7/32");
    expect(cidrs).toContain("100.64.0.0/10");
    expect(cidrs.some((cidr) => cidr.includes(":"))).toBe(false);
  });
});

describe("verifyEgressRules", () => {
  const cidrs = blockedCidrs([]);

  test("accepts a complete read-back", () => {
    expect(
      verifyEgressRules(
        readBack(cidrs, [JUMP, "-A DOCKER-USER -j RETURN"], [INPUT_DROP]),
        BRIDGE,
        cidrs,
      ),
    ).toEqual([]);
  });

  test("reports a missing range", () => {
    const problems = verifyEgressRules(
      readBack(
        cidrs.filter((cidr) => cidr !== "172.16.0.0/12"),
        [JUMP],
        [INPUT_DROP],
      ),
      BRIDGE,
      cidrs,
    );
    expect(problems).toEqual(["no drop for 172.16.0.0/12"]);
  });

  test("reports a RETURN ahead of the jump", () => {
    expect(
      verifyEgressRules(
        readBack(cidrs, ["-A DOCKER-USER -j RETURN", JUMP], [INPUT_DROP]),
        BRIDGE,
        cidrs,
      ),
    ).toEqual(["DOCKER-USER returns before the egress jump"]);
  });

  test("reports a host reachable from the bridge", () => {
    expect(
      verifyEgressRules(readBack(cidrs, [JUMP], []), BRIDGE, cidrs),
    ).toEqual(["INPUT does not drop the bridge"]);
  });

  test("an empty read-back fails every check", () => {
    expect(verifyEgressRules("", BRIDGE, cidrs).length).toBe(
      BLOCKED_V4.length + 2,
    );
  });
});

describe("applying the rules", () => {
  const STATE = "/run/user/1001/dockerd-rootless";
  const IMAGE = `ghcr.io/denizlg24/agent-runner-runtime@sha256:${"a".repeat(64)}`;
  const config = {
    network: "agent-runs",
    bridge: BRIDGE,
    blockedAddresses: [],
    rootlesskitStateDir: STATE,
    image: IMAGE,
  };
  const docker: Pick<Docker, "networkExists" | "createNetwork"> = {
    networkExists: async () => true,
    createNetwork: async () => {},
  };

  test("a privileged runc helper enters rootlesskit's detached netns", () => {
    const argv = egressCommand(IMAGE, STATE, 1133, BRIDGE, ["10.0.0.0/8"]);
    expect(argv.slice(0, 2)).toEqual(["docker", "run"]);
    const image = argv.indexOf(IMAGE);
    const flags = argv.slice(2, image).join(" ");
    expect(flags).toContain("--runtime runc");
    expect(flags).toContain("--pid host");
    expect(flags).toContain("--privileged");
    expect(flags).toContain("--network none");
    expect(flags).toContain("--entrypoint nsenter");
    expect(argv[image + 1]).toBe(`--net=/proc/1133/root${STATE}/netns`);
    expect(argv.slice(-2)).toEqual([BRIDGE, "10.0.0.0/8"]);
  });

  test("a child_pid that is not a pid is refused", () => {
    expect(() => parseChildPid("")).toThrow(EgressError);
    expect(() => parseChildPid("1")).toThrow(EgressError);
    expect(parseChildPid("1133\n")).toBe(1133);
  });

  test("a complete read-back passes; a failed helper does not", async () => {
    const cidrs = blockedCidrs([]);
    const calls: string[][] = [];
    const ok: CommandRunner = async (argv) => {
      calls.push(argv);
      return {
        exitCode: 0,
        stdout: readBack(cidrs, [JUMP], [INPUT_DROP]),
        stderr: "",
        timedOut: false,
      };
    };
    await applyEgressRules(docker, ok, config, async () => "1133");
    expect(calls[0]?.slice(0, 2)).toEqual(["docker", "run"]);

    const denied: CommandRunner = async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "iptables: Permission denied (you must be root)",
      timedOut: false,
    });
    await expect(
      applyEgressRules(docker, denied, config, async () => "1133"),
    ).rejects.toThrow("you must be root");
  });
});

describe("resolvConf", () => {
  test("names each server and nothing from the daemon", () => {
    expect(resolvConf(["1.1.1.1", "9.9.9.9"])).toBe(
      "nameserver 1.1.1.1\nnameserver 9.9.9.9\noptions timeout:2 attempts:2\n",
    );
  });
});
