import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

const backup = resolve(
  import.meta.dir,
  "../../../infra/scripts/posix-namespace-backup.sh",
);
const verify = resolve(
  import.meta.dir,
  "../../../infra/scripts/posix-namespace-restore-verify.sh",
);

describe("namespace backup and restore verification", () => {
  it("both scripts have valid shell syntax", () => {
    expect(Bun.spawnSync(["bash", "-n", backup]).exitCode).toBe(0);
    expect(Bun.spawnSync(["bash", "-n", verify]).exitCode).toBe(0);
  });

  it("backs up both branches rather than the merged view", () => {
    // A merged-view backup hides which branch holds a path, so a restore from
    // it cannot reproduce tier placement or diagnose a branch duplicate.
    const source = Bun.file(backup);
    expect(source).toBeDefined();
    const text = Bun.spawnSync(["cat", backup]).stdout.toString();
    expect(text).toContain("--xattrs-include='security.*'");
    expect(text).toContain("--acls");
    expect(text).toContain("--sparse");
    expect(text).toContain("mergedViewOnly:false");
  });

  it("refuses to back up a branch with no filesystem marker", () => {
    const result = Bun.spawnSync({
      cmd: ["bash", backup],
      env: {
        ...process.env,
        POSIX_BACKUP_HDD_BRANCH: "/nonexistent-hdd",
        POSIX_BACKUP_SSD_BRANCH: "/tmp",
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(result.exitCode).not.toBe(0);
    // Backing up an unmounted branch archives an empty directory, and that
    // restores as mass deletion. On the Pi this stops at the marker check; on
    // a dev machine it stops earlier at the missing GNU tooling.
    expect(result.stderr.toString()).toMatch(
      /marker is missing|is missing or unsafe|Required command is missing/,
    );
  });

  it("requires an absolute backup directory to verify", () => {
    const result = Bun.spawnSync({
      cmd: ["bash", verify, "--backup", "relative/path"],
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(result.exitCode).not.toBe(0);
  });
});
