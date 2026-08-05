import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

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

describe("POSIX production host boundary", () => {
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

  it("does not enable the empirically unsafe human shares", async () => {
    const config = await Bun.file(SAMBA).text();
    expect(config).toContain("[Personal]");
    expect(config).toContain("[Shared]");
    expect(config.match(/available = no/g)?.length).toBe(2);
    expect(config).toContain("[ApiBroker]");
    expect(config).toContain("hosts allow = 127.0.0.1");
    expect(config).toContain("vfs objects = full_audit");
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
});
