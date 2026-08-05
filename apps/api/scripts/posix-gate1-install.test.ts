import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

const INSTALL_SCRIPT = resolve(
  import.meta.dir,
  "../../../infra/scripts/posix-gate1-install.sh",
);
const PREFLIGHT_SCRIPT = resolve(
  import.meta.dir,
  "../../../infra/scripts/posix-gate1-preflight.sh",
);

describe("POSIX Gate 1 package installer safety", () => {
  it("proves the APT transaction before masking Samba", async () => {
    const source = await Bun.file(INSTALL_SCRIPT).text();
    const updateOffset = source.indexOf("apt-get update");
    const simulationOffset = source.indexOf("apt-get --simulate install");
    const firstMaskOffset = source.indexOf("systemctl mask --now");
    const installOffset = source.indexOf(
      'apt-get install -y "${packages[@]}" "$deb_path"',
    );

    expect(updateOffset).toBeGreaterThan(-1);
    expect(simulationOffset).toBeGreaterThan(updateOffset);
    expect(firstMaskOffset).toBeGreaterThan(simulationOffset);
    expect(installOffset).toBeGreaterThan(firstMaskOffset);
  });

  it("gives a safe recovery for mismatched ACL libraries", async () => {
    const source = await Bun.file(INSTALL_SCRIPT).text();

    expect(source).toContain("inconsistent Ubuntu package sources");
    expect(source).toContain("make sure noble-updates is enabled");
    expect(source).toContain("Do not downgrade libacl1 or libattr1");
  });

  it("normalizes mergerfs release output and keeps the local deb readable by APT", async () => {
    const source = await Bun.file(INSTALL_SCRIPT).text();

    expect(source).toContain('chmod 755 "$download_dir"');
    expect(source).toContain('chmod 644 "$deb_path"');
    expect(source).toContain('sub(/^v/, "", $NF)');
  });

  it("uses the same normalized mergerfs version in host preflight", async () => {
    const source = await Bun.file(PREFLIGHT_SCRIPT).text();

    expect(source).toContain('sub(/^v/, "", $NF)');
    expect(source).toContain('$mergerfsVersion=="2.42.0"');
    expect(source).toContain("mountpoint nft setfacl");
  });
});
