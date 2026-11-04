import { readFile } from "node:fs/promises";
import type { RunnerConfig } from "./config";
import type { Docker } from "./docker";
import type { CommandRunner } from "./exec";

const EGRESS_CHAIN = "AGENT-RUNS-EGRESS";

/**
 * The host, not "the internet": loopback, RFC 1918 (which holds the Forge
 * bridge 172.18.0.1 and the sandbox daemon's TCP listener), CGNAT/tailnet,
 * link-local, and the unroutable blocks — the same boundary `apps/browser`
 * enforces on resolved addresses.
 */
export const BLOCKED_V4 = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

/** `iptables -S` prints a bare address as /32. */
export function normalizeCidr(entry: string): string {
  return entry.includes("/") ? entry : `${entry}/32`;
}

export function blockedCidrs(extra: string[]): string[] {
  const v4 = extra.filter((entry) => !entry.includes(":"));
  return [...new Set([...BLOCKED_V4, ...v4].map(normalizeCidr))];
}

/**
 * Run as `sh -c <script> sh <bridge> <cidr>...` inside the rootlesskit
 * network namespace. Idempotent: the egress chain is flushed and refilled and
 * each jump is added only when `-C` cannot find it. IPv6 is dropped wholesale
 * on the bridge (the network is created without it); a missing ip6tables is
 * reported, not fatal.
 */
export const EGRESS_SCRIPT = `set -eu
bridge="$1"; shift
iptables -N ${EGRESS_CHAIN} 2>/dev/null || true
iptables -F ${EGRESS_CHAIN}
for cidr in "$@"; do iptables -A ${EGRESS_CHAIN} -d "$cidr" -j DROP; done
iptables -N DOCKER-USER 2>/dev/null || true
iptables -C DOCKER-USER -i "$bridge" -j ${EGRESS_CHAIN} 2>/dev/null || iptables -I DOCKER-USER 1 -i "$bridge" -j ${EGRESS_CHAIN}
iptables -C INPUT -i "$bridge" -j DROP 2>/dev/null || iptables -I INPUT 1 -i "$bridge" -j DROP
{ ip6tables -N DOCKER-USER 2>/dev/null || true; ip6tables -C DOCKER-USER -i "$bridge" -j DROP 2>/dev/null || ip6tables -I DOCKER-USER 1 -i "$bridge" -j DROP; } || echo "ip6tables unavailable" >&2
echo "=== egress"; iptables -S ${EGRESS_CHAIN}
echo "=== docker-user"; iptables -S DOCKER-USER
echo "=== input"; iptables -S INPUT
`;

function sections(output: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    const header = /^=== (\S+)$/.exec(line);
    if (header?.[1]) {
      current = [];
      result.set(header[1], current);
    } else if (current && line.startsWith("-A ")) {
      current.push(line);
    }
  }
  return result;
}

/** What is missing from the read-back; empty means the boundary holds. */
export function verifyEgressRules(
  output: string,
  bridge: string,
  cidrs: string[],
): string[] {
  const parts = sections(output);
  const problems: string[] = [];
  const egress = parts.get("egress") ?? [];
  for (const cidr of cidrs) {
    if (!egress.includes(`-A ${EGRESS_CHAIN} -d ${cidr} -j DROP`)) {
      problems.push(`no drop for ${cidr}`);
    }
  }
  const user = parts.get("docker-user") ?? [];
  const jump = user.indexOf(`-A DOCKER-USER -i ${bridge} -j ${EGRESS_CHAIN}`);
  const firstReturn = user.findIndex((line) => line.endsWith("-j RETURN"));
  if (jump === -1)
    problems.push("DOCKER-USER does not jump to the egress chain");
  else if (firstReturn !== -1 && firstReturn < jump) {
    problems.push("DOCKER-USER returns before the egress jump");
  }
  if (!(parts.get("input") ?? []).includes(`-A INPUT -i ${bridge} -j DROP`)) {
    problems.push("INPUT does not drop the bridge");
  }
  return problems;
}

export class EgressError extends Error {}

type NetworkDocker = Pick<Docker, "networkExists" | "createNetwork">;

export async function ensureNetwork(
  docker: NetworkDocker,
  config: Pick<RunnerConfig, "network" | "bridge">,
): Promise<void> {
  if (await docker.networkExists(config.network)) return;
  await docker.createNetwork(config.network, config.bridge);
}

/**
 * The command that applies and reads back the drop rules.
 *
 * Not a container: the daemon runs rootlesskit with `--detach-netns`, so a
 * `--network host` container lands in the real host netns, where uid 1001
 * holds no privilege (measured on Forge: iptables answers "you must be
 * root"). The bridges live in rootlesskit's detached netns instead. The runner
 * is the user that owns rootlesskit, so it can enter rootlesskit's user
 * namespace — where it is root — and that netns, and run the host's own
 * iptables there. Root here is root of that user namespace only.
 */
export function egressCommand(
  stateDir: string,
  childPid: number,
  bridge: string,
  cidrs: readonly string[],
): string[] {
  return [
    "nsenter",
    "--user",
    "--preserve-credentials",
    `--target=${childPid}`,
    `--net=/proc/${childPid}/root${stateDir}/netns`,
    "--",
    "sh",
    "-c",
    EGRESS_SCRIPT,
    "sh",
    bridge,
    ...cidrs,
  ];
}

export function parseChildPid(text: string): number {
  const pid = Number.parseInt(text.trim(), 10);
  if (!Number.isInteger(pid) || pid <= 1) {
    throw new EgressError(`rootlesskit child_pid is not a pid: ${text.trim()}`);
  }
  return pid;
}

export async function applyEgressRules(
  docker: NetworkDocker,
  exec: CommandRunner,
  config: Pick<
    RunnerConfig,
    "network" | "bridge" | "blockedAddresses" | "rootlesskitStateDir"
  >,
  readText: (path: string) => Promise<string> = (path) =>
    readFile(path, "utf8"),
): Promise<void> {
  await ensureNetwork(docker, config);
  const cidrs = blockedCidrs(config.blockedAddresses);
  const childPid = parseChildPid(
    await readText(`${config.rootlesskitStateDir}/child_pid`),
  );
  const result = await exec(
    egressCommand(config.rootlesskitStateDir, childPid, config.bridge, cidrs),
    { timeoutMs: 60_000 },
  );
  if (result.exitCode !== 0) {
    throw new EgressError(
      `applying egress rules failed: ${result.stderr.trim().slice(0, 500)}`,
    );
  }
  const problems = verifyEgressRules(result.stdout, config.bridge, cidrs);
  if (problems.length > 0) {
    throw new EgressError(
      `egress rules did not read back: ${problems.join("; ")}`,
    );
  }
}

/** Every run's /etc/resolv.conf; see `AGENT_RUNNER_DNS`. */
export function resolvConf(servers: readonly string[]): string {
  return `${servers.map((server) => `nameserver ${server}`).join("\n")}\noptions timeout:2 attempts:2\n`;
}
