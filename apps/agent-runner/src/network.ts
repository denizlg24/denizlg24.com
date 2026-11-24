import { readFile } from "node:fs/promises";
import type { RunnerConfig } from "./config";
import type { Docker } from "./docker";
import type { CommandRunner } from "./exec";

const EGRESS_CHAIN = "AGENT-RUNS-EGRESS";

/**
 * One fixed name, so at most one helper exists. Killing the `docker run` CLI
 * on a timeout leaves its container running; on 2026-11-23 a check that
 * timed out under load left its helper behind, every later check added
 * another, and some sixty privileged iptables processes livelocked on the
 * netns's ruleset for a day while the runner admitted nothing.
 */
export const EGRESS_HELPER_NAME = "agent-runner-egress";
/** Inside the helper; the CLI's own timeout sits above it. */
const EGRESS_SCRIPT_TIMEOUT_SECONDS = 60;
const EGRESS_CLI_TIMEOUT_MS = 120_000;

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
 * network namespace. Idempotent: the egress chain is flushed and refilled in
 * one `iptables-restore` commit, so a helper killed mid-refresh never leaves
 * running containers behind an empty chain (verified on Forge's
 * iptables-nft 1.8.11: declaring an existing chain under `--noflush` flushes
 * only that chain), and
 * each jump is added only when `-C` cannot find it. IPv6 is dropped wholesale
 * on the bridge (the network is created without it); a missing ip6tables is
 * reported, not fatal.
 */
export const EGRESS_SCRIPT = `set -eu
bridge="$1"; shift
{ echo "*filter"; echo ":${EGRESS_CHAIN} - [0:0]"; for cidr in "$@"; do echo "-A ${EGRESS_CHAIN} -d $cidr -j DROP"; done; echo COMMIT; } | iptables-restore --noflush
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
 * The command that applies and reads back the drop rules: a privileged runc
 * helper on the rootless daemon that `nsenter`s rootlesskit's detached netns,
 * where the bridges live.
 *
 * Two routes that look simpler fail on Forge (measured 2026-11-07). A
 * `--network host` container lands in the real host netns, because rootlesskit
 * runs with `--detach-netns`, and holds no privilege there. A host-side
 * `nsenter --user` into rootlesskit's user namespace is denied every
 * capability by Ubuntu's `apparmor_restrict_unprivileged_userns`, so iptables
 * answers "you must be root". A container the daemon starts inherits the
 * rootlesskit profile and is root of that user namespace — and only of it —
 * so `--privileged --pid=host` reaches the netns through
 * `/proc/<child_pid>/root` and nothing on the host.
 */
export function egressCommand(
  image: string,
  stateDir: string,
  childPid: number,
  bridge: string,
  cidrs: readonly string[],
): string[] {
  return [
    "docker",
    "run",
    "--rm",
    "--name",
    EGRESS_HELPER_NAME,
    "--runtime",
    "runc",
    "--network",
    "none",
    "--pid",
    "host",
    "--privileged",
    "--user",
    "0:0",
    "--entrypoint",
    "nsenter",
    image,
    `--net=/proc/${childPid}/root${stateDir}/netns`,
    "--",
    "timeout",
    "-s",
    "KILL",
    String(EGRESS_SCRIPT_TIMEOUT_SECONDS),
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
    "network" | "bridge" | "blockedAddresses" | "rootlesskitStateDir" | "image"
  >,
  readText: (path: string) => Promise<string> = (path) =>
    readFile(path, "utf8"),
): Promise<void> {
  await ensureNetwork(docker, config);
  const cidrs = blockedCidrs(config.blockedAddresses);
  const childPid = parseChildPid(
    await readText(`${config.rootlesskitStateDir}/child_pid`),
  );
  const removeHelper = () =>
    exec(["docker", "rm", "--force", EGRESS_HELPER_NAME], {
      timeoutMs: 60_000,
    });
  // A leftover from a check whose CLI was killed would hold the name.
  await removeHelper();
  const result = await exec(
    egressCommand(
      config.image,
      config.rootlesskitStateDir,
      childPid,
      config.bridge,
      cidrs,
    ),
    { timeoutMs: EGRESS_CLI_TIMEOUT_MS },
  );
  if (result.timedOut) {
    await removeHelper();
    throw new EgressError(
      `applying egress rules timed out after ${EGRESS_CLI_TIMEOUT_MS / 1000} s`,
    );
  }
  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim().slice(0, 500);
    throw new EgressError(
      `applying egress rules failed (exit ${result.exitCode})${stderr ? `: ${stderr}` : ""}`,
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
