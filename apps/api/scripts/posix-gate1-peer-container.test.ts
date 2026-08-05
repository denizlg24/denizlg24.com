import { describe, expect, it } from "bun:test";

const script = new URL(
  "../../../infra/scripts/posix-gate1-peer-container.sh",
  import.meta.url,
).pathname;
const runId = "12345678-1234-4234-8234-123456789abc";

async function invoke(...args: string[]) {
  return Bun.$`bash ${script} ${args}`.quiet().nothrow();
}

describe("POSIX Gate 1 peer container wrapper", () => {
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
});
