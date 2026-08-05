import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

const script = new URL(
  "../../../infra/scripts/posix-gate1-windows.ps1",
  import.meta.url,
).pathname;

describe("POSIX Gate 1 Windows client contract", () => {
  it("uses the exact disposable root and marker required by the API peer", async () => {
    const source = await readFile(script, "utf8");

    expect(source).toContain(
      '$script:PeerRoot = "{0}:\\posix-gate1-disposable-{1}" -f $DriveName, $RunId',
    );
    expect(source).toContain(
      '[IO.File]::WriteAllText($Marker, "deniz-cloud-posix-gate1`n", [Text.UTF8Encoding]::new($false))',
    );
  });

  it("keeps SSH non-interactive and validates the explicit endpoint", async () => {
    const source = await readFile(script, "utf8");

    expect(source).toContain('"--ssh-host"');
    expect(source).toContain("SSH HOST contains unsupported characters");
    expect(source).toContain('"BatchMode=yes"');
    expect(source).not.toContain('"sudo", "-n"');

    const sshArguments = source.slice(
      source.indexOf("$SshArguments = @("),
      source.indexOf("$StderrPath =", source.indexOf("$SshArguments = @(")),
    );
    expect(sshArguments).not.toContain("Credential");
    expect(sshArguments).not.toContain("Password");
  });

  it("makes direct mutation under FileShare.None a STOP failure", async () => {
    const source = await readFile(script, "utf8");

    expect(source).toContain("[IO.FileShare]::None");
    expect(source).toContain(
      '$Status = if ($DirectActionBlocked) { "pass" } else { "fail" }',
    );
    expect(source).toContain(
      'throw "STOP: direct API namespace mutation succeeded while Windows held FileShare.None"',
    );
    expect(source).toContain(
      'foreach ($Action in @("atomic-replace", "rename", "unlink"))',
    );
    expect(source).toContain(
      "([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)",
    );
    expect(source).toContain(
      'Write-Evidence -Event "shared-delete-lost-update" -Status "pass"',
    );
  });

  it("returns from dry-run before credentials, local writes, or SSH", async () => {
    const source = await readFile(script, "utf8");
    const dryRunExit = source.indexOf("    exit 0\n}\n\n$RunId");

    expect(dryRunExit).toBeGreaterThan(0);
    expect(source.indexOf("Get-Credential")).toBeGreaterThan(dryRunExit);
    expect(
      source.indexOf("[IO.File]::WriteAllText($EvidencePath"),
    ).toBeGreaterThan(dryRunExit);
    expect(source.indexOf("& $Ssh.Source")).toBeGreaterThan(dryRunExit);
  });
});
