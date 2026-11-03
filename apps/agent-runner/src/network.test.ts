import { describe, expect, test } from "bun:test";
import { BLOCKED_V4, blockedCidrs, verifyEgressRules } from "./network";

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
