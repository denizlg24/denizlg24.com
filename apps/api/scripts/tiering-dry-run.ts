import {
  createDb,
  createTieringRepository,
  requiredEnv,
  runTieringPass,
  storageConfigFromEnv,
} from "@repo/cloud-core";

import { runScript, ScriptError } from "./lib/runner";

/**
 * Reports what the nightly `tiering_pass` would move, without moving anything.
 *
 * Mirrors the executor's option resolution exactly (see the `tiering_pass` case
 * in src/ops/executors/index.ts) so the preview reflects the scheduled task
 * rather than an approximation of it. `dryRun` short-circuits inside
 * runTieringPass before both the atomic move and the stale-copy delete, so no
 * file or row is touched.
 */

await runScript("tiering-dry-run", async (flags) => {
  if (!flags.dryRun) {
    throw new ScriptError(
      "tiering-dry-run never mutates; run the scheduled task to move data",
    );
  }

  const storage = storageConfigFromEnv();
  const db = createDb(requiredEnv("DATABASE_URL"), { max: 1 });

  try {
    const report = await runTieringPass(createTieringRepository(db), {
      batchCap: storage.tiering.batchCap,
      dryRun: true,
      hddStoragePath: storage.hddStoragePath,
      highWatermarkPercent: storage.tiering.highWatermarkPercent,
      minAgeMs: storage.tiering.minAgeMs,
      minSizeBytes: storage.tiering.minSizeBytes,
      ssdStoragePath: storage.ssdStoragePath,
      targetWatermarkPercent: storage.tiering.targetWatermarkPercent,
    });

    const movedBytes = report.moved.reduce(
      (total, move) => total + move.sizeBytes,
      0,
    );
    const byReason = new Map<string, number>();
    for (const move of report.moved) {
      byReason.set(move.reason, (byReason.get(move.reason) ?? 0) + 1);
    }

    return {
      thresholds: {
        batchCap: storage.tiering.batchCap,
        highWatermarkPercent: storage.tiering.highWatermarkPercent,
        minAgeDays: storage.tiering.minAgeMs / (24 * 60 * 60 * 1_000),
        minSizeBytes: storage.tiering.minSizeBytes,
        targetWatermarkPercent: storage.tiering.targetWatermarkPercent,
      },
      ssdUsagePercentBefore: Number(report.initialSsdUsagePercent.toFixed(2)),
      ssdUsagePercentAfter: Number(report.finalSsdUsagePercent.toFixed(2)),
      considered: report.considered,
      wouldMove: report.moved.length,
      wouldMoveBytes: movedBytes,
      wouldMoveByReason: Object.fromEntries(byReason),
      staleCopiesReconciled: report.reconciledCopies,
      vanished: report.vanished,
      healed: report.healed,
      orphaned: report.orphaned.length,
      failures: report.failures.length,
      sample: report.moved.slice(0, 10).map((move) => ({
        filename: move.filename,
        reason: move.reason,
        sizeBytes: move.sizeBytes,
      })),
    };
  } finally {
    await db.$client.end({ timeout: 5 });
  }
});
