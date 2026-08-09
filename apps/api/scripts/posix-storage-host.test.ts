import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { POSIX_GATE1_SUPPORTED } from "./posix-gate1-platform";

const HOST = resolve(
  import.meta.dir,
  "../../../infra/scripts/posix-storage-host.sh",
);
const INSTALL = resolve(
  import.meta.dir,
  "../../../infra/scripts/install-posix-storage-host.sh",
);
const EXPORT = resolve(
  import.meta.dir,
  "../../../infra/scripts/posix-gate1-export.sh",
);
const SAMBA = resolve(
  import.meta.dir,
  "../../../infra/samba/posix-storage-smb.conf",
);
const FIREWALL = resolve(
  import.meta.dir,
  "../../../infra/systemd/deniz-cloud-storage-firewall.service",
);
const WATCHDOG = resolve(
  import.meta.dir,
  "../../../infra/systemd/deniz-cloud-storage-watchdog.service",
);

describe.skipIf(!POSIX_GATE1_SUPPORTED)(
  "POSIX production host boundary",
  () => {
    it("is dry-run by default and keeps S3 outside the namespace", async () => {
      const process = Bun.spawn(["bash", HOST], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = await new Response(process.stdout).json();
      expect(await process.exited).toBe(0);
      expect(output).toMatchObject({
        mode: "--dry-run",
        writes: false,
        s3Included: false,
        containerWitnessPath: "/data/storage/.denizcloud-mount-witness",
      });
    });

    it("routes the API through the encrypted loopback Samba share", async () => {
      const source = await Bun.file(HOST).text();
      expect(source).toContain("//127.0.0.1/ApiBroker");
      expect(source).toContain("vers=3.1.1,seal,sign");
      expect(source).toContain("api-broker-witness");
      expect(source).toContain("smbd-listener");
      // The boundary, not the wording: loopback for the broker, the tailnet for
      // clients, and a reject for every other interface.
      expect(source).toContain(
        'iifname "lo" ip daddr 127.0.0.1 tcp dport 445 accept',
      );
      expect(source).toContain('iifname "tailscale0" tcp dport 445 accept');
      expect(source).toContain("tcp dport 445 reject with tcp reset");
      expect(source).toContain("Rendered API volumes bypass the broker");
      expect(source).toContain("Refusing to unmount a foreign broker mount");
      expect(source).toContain("Gate1B broker pilot");
      expect(source).toContain('local account_root="$merged/$account_id"');
    });

    it("arms the watchdog before it may withdraw the namespace", async () => {
      const source = await Bun.file(HOST).text();
      // The checks and the withdrawal are separate: a boundary that has not
      // finished starting must not be read as one that broke. The old shape
      // called fail_closed straight out of the check list, so a lost boot race
      // latched an outage nothing but `recover` could clear.
      expect(source).toContain("boundary_fault()");
      expect(source).not.toContain("|| fail_closed branch-validation");
      expect(source).not.toContain("|| fail_closed api-broker-mount");
      // Un-armed give-up is exit 21 and leaves the namespace mountable; only
      // fail_closed's exit 20 withdraws it, and only that one is restart-proof.
      expect(source).toContain("return 21");
      expect(source).toContain(
        'fault=$(boundary_fault) || fail_closed "$fault"',
      );
      const watchdog = await Bun.file(WATCHDOG).text();
      expect(watchdog).toContain("RestartPreventExitStatus=20");
      expect(watchdog).toContain("Restart=on-failure");
    });

    it("waits for the tailnet address instead of sampling it once", async () => {
      const source = await Bun.file(HOST).text();
      expect(source).toContain("wait_for_tailscale_address");
      expect(source).toContain("wait_for_tailscale_address || return 1");
      // systemd must not kill the wait it asked the script to perform.
      const firewall = await Bun.file(FIREWALL).text();
      const timeout = Number(
        /TimeoutStartSec=(\d+)/.exec(firewall)?.[1] ?? "0",
      );
      const wait = Number(
        /DENIZ_POSIX_TAILSCALE_WAIT:-(\d+)/.exec(source)?.[1] ?? "0",
      );
      expect(wait).toBeGreaterThan(0);
      expect(timeout).toBeGreaterThan(wait);
    });

    it("keeps the conditions the human shares were enabled under", async () => {
      const config = await Bun.file(SAMBA).text();
      expect(config).toContain("[Personal]");
      expect(config).toContain("[Shared]");
      expect(config).toContain("[ApiBroker]");
      expect(config).toContain("hosts allow = 127.0.0.1");
      expect(config).toContain("vfs objects = full_audit");
      // Gate 1 failed because streams_xattr accepted a reserved-looking ADS name
      // and exposed a directly addressable AppleDouble sidecar. Removing it is
      // what let the shares be enabled, so its return would silently reopen the
      // hole the gate was about.
      // Checked against the directives rather than the file, since the comment
      // explaining the removal necessarily names the module.
      const vfsLines = config.match(/^\s*vfs objects = .*$/gm) ?? [];
      expect(vfsLines.length).toBeGreaterThan(0);
      for (const line of vfsLines) expect(line).not.toContain("streams_xattr");
      // Samba expands %H to the *forced* user's home, so a share path of %H
      // serves the storage user's home directory to every device instead of the
      // account's own root. The per-principal include is what prevents that.
      expect(config).not.toMatch(/^\s*path = %H\s*$/m);
      expect(config).toContain(
        "include = /etc/samba/deniz-cloud-personal/%U.conf",
      );
    });

    it("installs without activation and uninstalls only an exact manifest", async () => {
      const source = await Bun.file(INSTALL).text();
      expect(source).toContain("activatesServices:false");
      expect(source).toContain('sha256sum -c "$manifest"');
      expect(source).toContain("refusing partial uninstall");
      expect(source).toContain("Mode may be specified only once");
      expect(source).toContain("namespaceDataDeleted:false");
    });

    it("exports marked Gate 1 evidence without credentials or teardown", async () => {
      const source = await Bun.file(EXPORT).text();
      expect(source).toContain("credentialsIncluded:false");
      expect(source).toContain("gate1Stopped:false");
      expect(source).toContain("gate1Destroyed:false");
      expect(source).not.toContain("client.auth");
      expect(source).not.toContain("passdb.tdb");
    });
  },
);
