import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SPIKE_SCRIPT = resolve(
  import.meta.dir,
  "../../../infra/scripts/posix-gate1-spike.sh",
);
const temporaryRoots: string[] = [];

interface ScriptResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

async function runSpike(
  args: readonly string[],
  stateRoot?: string,
  environment: Record<string, string> = {},
): Promise<ScriptResult> {
  const child = Bun.spawn(["/bin/bash", SPIKE_SCRIPT, ...args], {
    env: {
      ...process.env,
      ...(stateRoot === undefined ? {} : { POSIX_GATE1_ROOT: stateRoot }),
      ...environment,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  const exitCode = await child.exited;
  return { exitCode, stderr: await stderr, stdout: await stdout };
}

async function disposableStateRoot(): Promise<{
  parent: string;
  root: string;
}> {
  const parent = await mkdtemp(join(tmpdir(), "gate1-spike-script-test-"));
  temporaryRoots.push(parent);
  return { parent, root: join(parent, "posix-gate1-test") };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("POSIX Gate 1 spike shell safety", () => {
  it("normalizes the pinned mergerfs release version", async () => {
    const source = await Bun.file(SPIKE_SCRIPT).text();

    expect(source).toContain('sub(/^v/, "", $NF)');
    expect(source).toContain('!= "2.42.0"');
  });

  it("keeps Samba runtime sockets private and supports a prepared-phase retry", async () => {
    const source = await Bun.file(SPIKE_SCRIPT).text();
    const template = await Bun.file(
      resolve(import.meta.dir, "../../../infra/samba/posix-gate1-smb.conf.in"),
    ).text();

    expect(source).toContain('-e "s|@NCALRPC_DIR@|$samba_root/ncalrpc|g"');
    expect(source).toContain('mkdir -p "$samba_root/private"');
    expect(source).toContain(
      'chmod 755 "$samba_root/state" "$samba_root/cache" "$samba_root/lock" "$samba_root/ncalrpc"',
    );
    expect(template).toContain("ncalrpc dir = @NCALRPC_DIR@");
    expect(template).toContain("bind interfaces only = no");
    expect(template).toContain(
      "hosts allow = 127.0.0.1 100.64.0.0/10 fd7a:115c:a1e0::/48",
    );
    expect(template).toContain("hosts deny = ALL");
    expect(template).not.toContain("interfaces = tailscale0");
    expect(template).not.toContain("interfaces = @TAILSCALE_IP@/32");
    expect(source).toContain('.phase="starting"');
    expect(source).toContain("state_samba_process_is_verified");
    expect(source).toContain("recover_withdrawn_samba_start");
    expect(source).toContain("Refusing recovery while TCP 445 has a listener");
    expect(source).toContain("stale-samba-start-withdrawn");
    expect(source).toContain("api_main_evidence_is_complete");
    expect(source).toContain("api_slow_evidence_is_complete");
    expect(source).toContain(".incomplete-${incomplete_suffix}");
    expect(source).toContain("reusedEvidence:true");
    expect(source).toContain("kill -KILL");
    expect(source).toContain("trap cleanup_failed_samba EXIT");
    expect(source).toContain("trap 'exit 129' HUP");
    expect(source).toContain(
      "Disposable smbd did not open a firewall-protected wildcard listener",
    );
    expect(source).toContain(
      'tail -n 80 "$samba_root/log/smbd.foreground.log" >&2 || true',
    );
    expect(source).toContain(
      'tail -n 120 "$samba_root/log/smbd.foreground.log" >&2 || true',
    );
    expect(source).toContain("startup_probe_process_is_verified");
    expect(source).toContain("stop_startup_encryption_probe");
    expect(source).toContain(
      "testparm -s --parameter-name='server smb encrypt'",
    );
    expect(source).toContain('smbstatus --json -s "$config"');
    expect(source).toContain("smbpasswd smbstatus ss stat");
    expect(source).toContain("--client-protection=off");
    expect(source).toContain("timeout --signal=TERM --kill-after=2s 12s");
    expect(source).toContain("12s sleep 30");
    expect(source).toContain("startup_probe_command_remains");
    expect(source).not.toContain("notify .");
    expect(source).toContain("startup_probe_start_time");
    expect(source).toContain("$root.sessions[($tcon.session_id | tostring)]");
    expect(source).toContain("encryptionObserved:true");
    expect(source).not.toContain("Samba accepted an unencrypted client");
    expect(source).toContain('firewall_table="deniz_cloud_gate1"');
    expect(source).toContain("install_gate1_firewall");
    expect(source).toContain("firewall_is_current_spike");
    expect(source).toContain("remove_gate1_firewall");
    expect(source).toContain(
      'iifname "lo" ip daddr 127.0.0.1 tcp dport 445 accept',
    );
    expect(source).toContain('iifname "tailscale0" tcp dport 445 accept');
    expect(source).toContain(
      'tcp dport 445 reject with tcp reset comment "deniz-cloud-gate1-${spike_id}-deny"',
    );
    expect(source).toContain("priority -100; policy accept;");
    expect(source).toContain("(chains | length) == 1");
    expect(source).toContain('has("accept") and .accept == null');
    expect(source).toContain(
      'firewall:{family:"inet",table:"deniz_cloud_gate1",interface:"tailscale0",port:445}',
    );
    expect(source).toContain("firewall_state=foreign");
  });

  it("permits only traversal to the fixed non-sudo peer mount", async () => {
    const source = await Bun.file(SPIKE_SCRIPT).text();

    expect(source).toContain('chmod 711 "$state_root" "$mount_dir"');
    expect(source).toContain('chmod 770 "$merged_mount"');
    expect(source).toContain('chown 1000:1000 "$merged_mount"');
    expect(source).toContain(
      'mkdir -m 700 "$state_root" "$image_dir" "$mount_dir" "$samba_root" "$evidence_dir"',
    );
  });

  it("defaults to dry-run and does not create the requested state root", async () => {
    const { root } = await disposableStateRoot();

    const result = await runSpike(["prepare"], root);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      action: "prepare",
      mode: "--dry-run",
      root,
      willMountProductionBranches: false,
    });
    expect(await Bun.file(root).exists()).toBe(false);
  });

  it("rejects conflicting modes and actions before doing any work", async () => {
    const { root } = await disposableStateRoot();
    const conflictingModes = await runSpike(
      ["--dry-run", "--execute", "status"],
      root,
    );
    const conflictingActions = await runSpike(
      ["--dry-run", "prepare", "destroy"],
      root,
    );

    for (const result of [conflictingModes, conflictingActions]) {
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Usage:");
    }
    expect(await Bun.file(root).exists()).toBe(false);
  });

  it("rejects descendants of current and future production roots", async () => {
    const protectedDescendants = [
      "/data/ssd/posix-gate1-test",
      "/mnt/hdd/storage/posix-gate1-test",
      "/mnt/ssd/deniz-cloud/namespace/posix-gate1-test",
      "/srv/deniz-cloud/namespace/posix-gate1-test",
    ];

    for (const root of protectedDescendants) {
      const result = await runSpike(["--dry-run", "prepare"], root);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("overlaps a protected production path");
    }
  });

  it("rejects ancestors and exact roots that could contain production", async () => {
    const protectedAncestorsOrExactRoots = [
      "/data",
      "/mnt/ssd",
      "/srv/deniz-cloud",
      "/opt/deniz-cloud",
    ];

    for (const root of protectedAncestorsOrExactRoots) {
      const result = await runSpike(["--dry-run", "prepare"], root);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(
        /specifically named absolute path|overlaps a protected production path/,
      );
    }
  });

  it("requires a normalized absolute state path", async () => {
    const invalidRoots = [
      "relative/posix-gate1-test",
      "/tmp//posix-gate1-test",
      "/tmp/./posix-gate1-test",
      "/tmp/child/../posix-gate1-test",
    ];

    for (const root of invalidRoots) {
      const result = await runSpike(["--dry-run", "status"], root);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("must be a normalized absolute path");
    }
  });

  it("never represents a dry-run host test as a Gate 1 pass", async () => {
    const { root } = await disposableStateRoot();

    const result = await runSpike(["--dry-run", "host-test"], root);

    expect(result.exitCode).toBe(0);
    const summary = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(summary).toMatchObject({
      action: "host-test",
      mode: "--dry-run",
      willMountProductionBranches: false,
    });
    expect(summary).not.toHaveProperty("allGreen", true);
    expect(summary).not.toHaveProperty("gate1Passed", true);
    expect(summary).not.toHaveProperty("hostTestsPassed", true);
  });

  it("keeps branch-loss, watchdog and reboot probes bounded and non-passing in dry-run", async () => {
    const { root } = await disposableStateRoot();

    for (const action of ["watchdog", "branch-loss-test", "reboot-check"]) {
      const result = await runSpike(["--dry-run", action], root, {
        POSIX_GATE1_WATCHDOG_TIMEOUT_SECONDS: "7",
      });

      expect(result.exitCode).toBe(0);
      const summary = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(summary).toMatchObject({
        action,
        gate1Passed: false,
        mode: "--dry-run",
        stopRequired: action !== "watchdog",
        watchdogTimeoutSeconds: 7,
        willMountProductionBranches: false,
      });
      expect(summary).not.toHaveProperty("branchLossWatchdogPassed", true);
      expect(summary).not.toHaveProperty("rebootSafetyPassed", true);
      expect(summary).not.toHaveProperty("watchdogHealthy", true);
    }
    expect(await Bun.file(root).exists()).toBe(false);
  });

  it("rejects unbounded or malformed watchdog deadlines before mutation", async () => {
    const { root } = await disposableStateRoot();

    for (const timeout of ["0", "31", "1.5", "unbounded"]) {
      const result = await runSpike(["--dry-run", "watchdog"], root, {
        POSIX_GATE1_WATCHDOG_TIMEOUT_SECONDS: timeout,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(
        "watchdog timeout must be an integer from 1 to 30 seconds",
      );
    }
    expect(await Bun.file(root).exists()).toBe(false);
  });

  it("accepts only the documented watchdog deadline boundaries", async () => {
    const { root } = await disposableStateRoot();

    for (const timeout of ["1", "30"]) {
      const result = await runSpike(["--dry-run", "watchdog"], root, {
        POSIX_GATE1_WATCHDOG_TIMEOUT_SECONDS: timeout,
      });

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        gate1Passed: false,
        watchdogTimeoutSeconds: Number(timeout),
      });
    }
    expect(await Bun.file(root).exists()).toBe(false);
  });

  it("keeps reboot verification fail-closed until branch markers are remounted", async () => {
    const source = await Bun.file(SPIKE_SCRIPT).text();

    expect(source).toContain(
      '.phase="quarantined" | .safety={status:"reboot-fail-closed-unverified-markers"',
    );
    expect(source).toContain("rebootFailClosedObserved:true");
    expect(source).toContain("rebootSafetyPassed:false");
    expect(source).toContain("branchMarkersRequireRemountVerification:true");
    expect(source).not.toContain("rebootSafetyPassed:true");
  });
});
