import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const SYNTHETIC_DEPENDENCIES = [
  "postgres",
  "mongodb",
  "redis",
  "posix",
  "objectStorage",
  "search",
  "storageProtocol",
] as const;

type SyntheticDependency = (typeof SYNTHETIC_DEPENDENCIES)[number];
type SyntheticProbe = (canary: string) => Promise<void>;

export type SyntheticResult = {
  status: "ok" | "down";
  timestamp: string;
  checks: Record<
    SyntheticDependency,
    { status: "ok" | "down"; latencyMs: number; error: string | null }
  >;
};

/** A write/read/delete probe for a mounted POSIX or object-storage root. */
export function filesystemSyntheticProbe(root: string): SyntheticProbe {
  return async (canary) => {
    const directory = join(root, ".dr-synthetic");
    const path = join(directory, canary);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(path, canary, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      if ((await readFile(path, "utf8")) !== canary) {
        throw new Error("canary read did not match its write");
      }
    } finally {
      await rm(path, { force: true });
    }
  };
}

/**
 * Runs the complete dependency transaction as one serialized check. A second
 * monitor hit shares the in-flight result instead of racing the same canaries.
 */
export class DeepSyntheticService {
  private inFlight: Promise<SyntheticResult> | null = null;

  constructor(
    private readonly probes: Record<SyntheticDependency, SyntheticProbe>,
  ) {}

  check(): Promise<SyntheticResult> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async run(): Promise<SyntheticResult> {
    const canary = randomUUID();
    const entries = await Promise.all(
      SYNTHETIC_DEPENDENCIES.map(async (name) => {
        const startedAt = performance.now();
        try {
          await this.probes[name](canary);
          return [
            name,
            {
              status: "ok" as const,
              latencyMs: performance.now() - startedAt,
              error: null,
            },
          ] as const;
        } catch (error) {
          return [
            name,
            {
              status: "down" as const,
              latencyMs: performance.now() - startedAt,
              error:
                error instanceof Error
                  ? error.message.slice(0, 300)
                  : "Probe failed",
            },
          ] as const;
        }
      }),
    );
    const checks = Object.fromEntries(entries) as SyntheticResult["checks"];
    return {
      status: Object.values(checks).every((check) => check.status === "ok")
        ? "ok"
        : "down",
      timestamp: new Date().toISOString(),
      checks,
    };
  }
}
