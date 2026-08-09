import { createDb, requiredEnv } from "@repo/cloud-core";
import { sql } from "drizzle-orm";

import { runScript, ScriptError } from "./lib/runner";

/**
 * Repoints disk metric series from kernel device paths onto filesystem UUIDs.
 *
 * Series used to be keyed `disk:/dev/sda1.usage_percent`. Kernel names are
 * assigned in probe order, so they are not an identity: on this host the 1 TB
 * HDD was `sda1`, became `sdc1` when a second disk joined the pool, and became
 * `sda1` again after the next reboot. Every rename silently ended one series and
 * started another, and the reuse of `sda1` is worse than a gap — it appends a
 * different disk's history onto the first one's.
 *
 * The sampler now writes the UUID, so this is the one-off catch-up for rows
 * already stored. It is deliberately not a schema migration: the device -> UUID
 * mapping is a fact about one host's cabling history that nothing in the
 * database records, so it is supplied explicitly rather than guessed.
 *
 * Safe to re-run. Rows already carrying a UUID prefix are not matched, so a
 * second `--execute` reports zero updates rather than double-rewriting.
 */

interface Remap {
  /** Device paths whose history belongs to this disk, oldest spelling first. */
  devices: string[];
  uuid: string;
}

/**
 * Supplied as `--map=<uuid>=<device>[,<device>...]`, repeatable. Nothing is
 * defaulted: an operator naming the wrong disk would merge two histories
 * irreversibly, so the mapping has to be typed out against `lsblk -o NAME,UUID`
 * on the host being migrated.
 */
function parseMaps(argv: readonly string[]): Remap[] {
  const maps: Remap[] = [];
  for (const argument of argv) {
    if (!argument.startsWith("--map=")) continue;
    const [uuid, devices] = argument.slice("--map=".length).split("=");
    if (!uuid || !devices) {
      throw new ScriptError(
        `Malformed --map (want --map=<uuid>=<device>[,<device>]): ${argument}`,
      );
    }
    const parsed = devices.split(",").filter(Boolean);
    if (parsed.some((device) => !device.startsWith("/dev/"))) {
      throw new ScriptError(`--map devices must be /dev/ paths: ${argument}`);
    }
    maps.push({ devices: parsed, uuid: uuid.toLowerCase() });
  }
  if (maps.length === 0) {
    throw new ScriptError(
      "At least one --map=<uuid>=<device>[,<device>] is required",
    );
  }
  const claimed = new Map<string, string>();
  for (const map of maps) {
    for (const device of map.devices) {
      const owner = claimed.get(device);
      if (owner && owner !== map.uuid) {
        throw new ScriptError(
          `${device} is mapped to two UUIDs (${owner}, ${map.uuid}); one device path cannot be two disks at once`,
        );
      }
      claimed.set(device, map.uuid);
    }
  }
  return maps;
}

await runScript("rekey-disk-metrics", async (flags, log) => {
  const maps = parseMaps(process.argv.slice(2));
  const db = createDb(requiredEnv("DATABASE_URL"));
  const counts: Record<string, number> = {};
  let total = 0;

  for (const { uuid, devices } of maps) {
    // The suffix is everything after the first dot — `usage_percent`,
    // `read_bytes_per_second` and friends — and a device path contains no dot,
    // so splitting on the first one cannot cut a key in the wrong place.
    const rows = await db.execute(sql`
      SELECT count(*)::int AS n
      FROM metrics_samples
      WHERE kind = 'disk'
        AND split_part(key, '.', 1) = ANY(${devices})
    `);
    const matched = Number(
      (rows as unknown as Array<{ n: number }>)[0]?.n ?? 0,
    );
    counts[uuid] = matched;
    total += matched;
    await log.event("map", { devices, matched, uuid });
    if (flags.dryRun || matched === 0) continue;
    await db.execute(sql`
      UPDATE metrics_samples
      SET key = ${uuid} || substring(key from position('.' in key))
      WHERE kind = 'disk'
        AND split_part(key, '.', 1) = ANY(${devices})
    `);
  }

  const remaining = await db.execute(sql`
    SELECT split_part(key, '.', 1) AS device, count(*)::int AS n
    FROM metrics_samples
    WHERE kind = 'disk' AND key LIKE '/dev/%'
    GROUP BY 1 ORDER BY 1
  `);

  return {
    matched: counts,
    total,
    // Anything still device-keyed after an --execute is a disk the operator did
    // not map. Reported rather than failed: an unmapped disk keeps working, it
    // just keeps the old rename behaviour until someone maps it.
    unmapped: (
      remaining as unknown as Array<{ device: string; n: number }>
    ).map((row) => ({ device: row.device, samples: Number(row.n) })),
  };
});
