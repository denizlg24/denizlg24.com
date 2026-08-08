import { describe, expect, it } from "bun:test";
import { POSIX_GATE1_SUPPORTED } from "./posix-gate1-platform";

const script = new URL(
  "../../../infra/scripts/posix-gate1-peer-container.sh",
  import.meta.url,
).pathname;
const runId = "12345678-1234-4234-8234-123456789abc";

async function invoke(...args: string[]) {
  return Bun.$`bash ${script} ${args}`.quiet().nothrow();
}

describe.skipIf(!POSIX_GATE1_SUPPORTED)(
  "POSIX Gate 1 peer container wrapper",
  () => {
    it("is a non-mutating dry-run with fixed disposable paths", async () => {
      const result = await invoke(
        "--action",
        "seed",
        "--run-id",
        runId,
        "--generation",
        "A",
      );
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.toString());
      expect(output).toMatchObject({
        action: "seed",
        mode: "dry-run",
        productionBranchesMounted: false,
        runId,
        writes: false,
      });
      expect(output.containerRoot).toBe(
        `/gate1/personal/posix-gate1-disposable-${runId}`,
      );
    });

    it("rejects conflicting modes and unsafe identifiers", async () => {
      expect(
        (
          await invoke(
            "--dry-run",
            "--execute",
            "--action",
            "seed",
            "--run-id",
            runId,
          )
        ).exitCode,
      ).toBe(2);
      expect(
        (await invoke("--action", "seed", "--run-id", "../../unsafe")).exitCode,
      ).toBe(2);
      expect(
        (await invoke("--action", "unknown", "--run-id", runId)).exitCode,
      ).toBe(2);
    });

    it("does not accept path overrides", async () => {
      const result =
        await Bun.$`POSIX_GATE1_MERGED_ROOT=/mnt/ssd/storage bash ${script} --action seed --run-id ${runId}`
          .quiet()
          .nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("fixed disposable");
    });

    it("validates the exact disposable mergerfs mount before Docker can bind it", async () => {
      const source = await Bun.file(script).text();

      expect(source).toContain(
        '"$(findmnt -n -o FSTYPE --target "$merged_root"',
      );
      expect(source).toContain('!= "fuse.mergerfs"');
      expect(source).toContain(
        '"$(findmnt -n -o SOURCE --target "$merged_root"',
      );
      expect(source).toContain('!= "deniz-cloud-gate1"');
      expect(
        source.indexOf("Disposable Gate 1 mergerfs mount is missing"),
      ).toBeLessThan(source.indexOf("docker run --rm"));
    });
  },
);
