import { describe, expect, it } from "bun:test";

import { BuildLogStore } from "./build-log";
import { deploymentRequest, fakeExec, withTempDir } from "./fixtures";
import {
  assertRecoveryEnvironmentHmac,
  publishRecoveryImage,
  recoveryImageRepository,
} from "./recovery-image";

describe("recovery images", () => {
  it("refuses a resolved environment that differs from the signed snapshot", () => {
    const expected = "a".repeat(64);
    expect(() =>
      assertRecoveryEnvironmentHmac(expected, expected),
    ).not.toThrow();
    expect(() =>
      assertRecoveryEnvironmentHmac("b".repeat(64), expected),
    ).toThrow(/signed recovery snapshot/);
  });

  it("accepts only a normalized private GHCR prefix", () => {
    expect(
      recoveryImageRepository("ghcr.io/denizlg24/forge-recovery/", "web"),
    ).toBe("ghcr.io/denizlg24/forge-recovery/web");
    expect(() => recoveryImageRepository("docker.io/public", "web")).toThrow(
      /private GHCR/,
    );
  });

  it("tags, pushes, records the returned digest, and verifies a digest pull", async () => {
    await withTempDir(async (dir) => {
      const digest = `sha256:${"a".repeat(64)}`;
      const exec = fakeExec((call) =>
        call.command[1] === "push"
          ? { stdout: `latest: digest: ${digest} size: 1234\n` }
          : undefined,
      );
      const logs = new BuildLogStore({ root: dir });
      const request = deploymentRequest({ projectSlug: "website" });
      const log = await logs.open(request.deploymentId);

      const result = await publishRecoveryImage({
        exec: exec.exec,
        log,
        request,
        localImage: "forge/website:local",
        registryPrefix: "ghcr.io/denizlg24/forge-recovery",
        signal: new AbortController().signal,
      });

      expect(result.digest).toBe(digest);
      expect(result.reference).toBe(
        `ghcr.io/denizlg24/forge-recovery/website@${digest}`,
      );
      expect(
        exec.commands.some((command) => command.includes("docker push")),
      ).toBe(true);
      expect(exec.commands.at(-1)).toContain(`docker pull ${result.reference}`);
      await logs.close(request.deploymentId);
    });
  });

  it("refuses a push with no registry digest", async () => {
    await withTempDir(async (dir) => {
      const exec = fakeExec();
      const request = deploymentRequest();
      const logs = new BuildLogStore({ root: dir });
      const log = await logs.open(request.deploymentId);
      await expect(
        publishRecoveryImage({
          exec: exec.exec,
          log,
          request,
          localImage: "forge/app:local",
          registryPrefix: "ghcr.io/denizlg24/forge-recovery",
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(/immutable sha256 digest/);
      await logs.close(request.deploymentId);
    });
  });
});
