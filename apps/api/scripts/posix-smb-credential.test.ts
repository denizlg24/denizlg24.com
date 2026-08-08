import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { POSIX_GATE1_SUPPORTED } from "./posix-gate1-platform";

const script = resolve(
  import.meta.dir,
  "../../../infra/scripts/posix-smb-credential.sh",
);

function run(args: string[], env: Record<string, string> = {}) {
  return Bun.spawnSync({
    cmd: ["bash", script, ...args],
    env: { ...process.env, ...env },
    stderr: "pipe",
    stdout: "pipe",
  });
}

describe.skipIf(!POSIX_GATE1_SUPPORTED)("SMB credential provisioning", () => {
  it("has valid shell syntax", () => {
    expect(Bun.spawnSync(["bash", "-n", script]).exitCode).toBe(0);
  });

  it("is dry-run by default and writes nothing", () => {
    const result = run([
      "provision",
      "--principal",
      "dc-macbook-abcd1234",
      "--account-id",
      "30000000-0000-4000-8000-000000000003",
    ]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toMatchObject({
      action: "provision",
      home: "/srv/deniz-cloud/storage/30000000-0000-4000-8000-000000000003",
      mode: "--dry-run",
      // A deleted principal frees its name for reuse, and a reused name is a
      // different device wearing an old identity.
      deletesPrincipal: false,
      secretRevealed: false,
      writes: false,
    });
  });

  it("rejects a principal that is not an exact derived name", () => {
    // This value reaches useradd, so it is validated rather than merely quoted.
    for (const principal of [
      "root",
      "dc-x; rm -rf /",
      "../../etc/passwd",
      "dc-UPPER-abcd1234",
      "dc-nosuffix",
      "",
    ]) {
      const result = run([
        "provision",
        "--principal",
        principal,
        "--account-id",
        "30000000-0000-4000-8000-000000000003",
      ]);
      expect(result.exitCode, principal).not.toBe(0);
    }
  });

  it("requires a canonical account UUID", () => {
    for (const id of ["not-a-uuid", "../escape", "30000000-0000-4000-8000"]) {
      const result = run([
        "provision",
        "--principal",
        "dc-macbook-abcd1234",
        "--account-id",
        id,
      ]);
      expect(result.exitCode, id).not.toBe(0);
      expect(result.stderr.toString()).toContain("account UUID");
    }
  });

  it("never reveals the secret in its output", () => {
    const result = run(
      [
        "provision",
        "--principal",
        "dc-macbook-abcd1234",
        "--account-id",
        "30000000-0000-4000-8000-000000000003",
      ],
      { POSIX_SMB_SECRET: "super-secret-value-not-to-be-logged" },
    );
    const output = result.stdout.toString() + result.stderr.toString();
    expect(output).not.toContain("super-secret-value");
  });

  it("keeps execute fail-closed without root", () => {
    const result = run([
      "revoke",
      "--principal",
      "dc-macbook-abcd1234",
      "--execute",
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toMatch(/requires root|Missing command/);
  });
});
