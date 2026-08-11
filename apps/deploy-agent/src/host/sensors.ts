import { readdir, readFile } from "node:fs/promises";

import type { ForgeSensor, ForgeSensorKind } from "@repo/schemas/cloud";

export const HWMON_ROOT = "/sys/class/hwmon";
export const POWERCAP_ROOT = "/sys/class/powercap";

/**
 * How a hwmon file's prefix maps to a kind, and what its raw integer means.
 *
 * Every hwmon value is an integer in a fixed unit chosen so no driver has to
 * emit a float: millidegrees, millivolts, microwatts, milliamps. RPM and PWM are
 * the exceptions and arrive as themselves.
 */
const SENSOR_KINDS: Record<string, { kind: ForgeSensorKind; divisor: number }> =
  {
    temp: { kind: "temperature", divisor: 1_000 },
    fan: { kind: "fan", divisor: 1 },
    in: { kind: "voltage", divisor: 1_000 },
    power: { kind: "power", divisor: 1_000_000 },
    curr: { kind: "current", divisor: 1_000 },
    energy: { kind: "energy", divisor: 1_000_000 },
    pwm: { kind: "pwm", divisor: 1 },
  };

export interface SensorReaderOptions {
  root?: string;
  readDir?: (path: string) => Promise<string[]>;
  readValue?: (path: string) => Promise<string>;
}

async function readTrimmed(path: string): Promise<string> {
  return (await readFile(path, "utf8")).trim();
}

async function optional(
  read: (path: string) => Promise<string>,
  path: string,
): Promise<string | null> {
  try {
    return await read(path);
  } catch {
    return null;
  }
}

function numberOrNull(raw: string | null, divisor: number): number | null {
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value / divisor : null;
}

/**
 * Every sensor every hwmon chip on the box publishes.
 *
 * This is the whole point of the tower: `/sys/class/thermal` gives one number
 * and hwmon gives the fans, the VRM rails, the per-die temperatures and the
 * package power. Nothing here is configured — the chips that appear are
 * whichever kernel modules are loaded, so a board whose `nct6775` is not loaded
 * simply reports fewer sensors rather than failing.
 *
 * Each read is independently fallible and independently skipped. A single
 * unreadable file on one chip must not cost the readings of every other.
 */
export async function readSensors(
  options: SensorReaderOptions = {},
): Promise<ForgeSensor[]> {
  const root = options.root ?? HWMON_ROOT;
  const readDir = options.readDir ?? ((path) => readdir(path));
  const readValue = options.readValue ?? readTrimmed;

  const chips = await readDir(root).catch(() => [] as string[]);
  const sensors: ForgeSensor[] = [];

  await Promise.all(
    chips.map(async (entry) => {
      const base = `${root}/${entry}`;
      const chip = (await optional(readValue, `${base}/name`)) ?? entry;
      const files = await readDir(base).catch(() => [] as string[]);

      const inputs = files.filter((file) => file.endsWith("_input"));
      await Promise.all(
        inputs.map(async (file) => {
          const key = file.slice(0, -"_input".length);
          const prefix = /^([a-z]+)\d+$/.exec(key)?.[1];
          const spec = prefix ? SENSOR_KINDS[prefix] : undefined;
          if (!spec) return;

          const value = numberOrNull(
            await optional(readValue, `${base}/${file}`),
            spec.divisor,
          );
          if (value === null) return;
          // A disconnected fan header reads 0 RPM forever. It is not a fan at
          // 0 rpm in any useful sense, and a tower has several unpopulated.
          if (spec.kind === "fan" && value === 0) return;

          sensors.push({
            chip,
            key,
            label: (await optional(readValue, `${base}/${key}_label`)) ?? key,
            kind: spec.kind,
            value,
            critical: numberOrNull(
              await optional(readValue, `${base}/${key}_crit`),
              spec.divisor,
            ),
            max: numberOrNull(
              await optional(readValue, `${base}/${key}_max`),
              spec.divisor,
            ),
          });
        }),
      );
    }),
  );

  return sensors.sort(
    (a, b) => a.chip.localeCompare(b.chip) || a.key.localeCompare(b.key),
  );
}

export interface EnergyCounter {
  zone: string;
  microjoules: number;
  at: number;
}

/**
 * RAPL energy counters, which are counters and not a power reading.
 *
 * The kernel exposes accumulated microjoules; watts is its derivative, which is
 * why this returns the raw counter and the collector differentiates. The counter
 * also wraps at `max_energy_range_uj`, so a decrease across two samples is a
 * wrap rather than negative power — the collector drops that interval instead of
 * charting a spike or a negative.
 */
export async function readEnergyCounters(
  options: SensorReaderOptions = {},
): Promise<EnergyCounter[]> {
  const root = options.root ?? POWERCAP_ROOT;
  const readDir = options.readDir ?? ((path) => readdir(path));
  const readValue = options.readValue ?? readTrimmed;

  const zones = (await readDir(root).catch(() => [] as string[])).filter(
    (entry) => entry.startsWith("intel-rapl:"),
  );
  const at = Date.now();
  const counters = await Promise.all(
    zones.map(async (entry) => {
      const base = `${root}/${entry}`;
      const raw = await optional(readValue, `${base}/energy_uj`);
      const microjoules = raw === null ? Number.NaN : Number(raw);
      if (!Number.isFinite(microjoules)) return null;
      return {
        zone: (await optional(readValue, `${base}/name`)) ?? entry,
        microjoules,
        at,
      };
    }),
  );
  return counters.filter(
    (counter): counter is EnergyCounter => counter !== null,
  );
}
